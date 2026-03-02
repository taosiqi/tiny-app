/**
 * @file main/index.js
 * @description Electron 主进程入口
 *
 * 负责：
 *  - 创建 BrowserWindow 并加载渲染层
 *  - 注册 IPC 处理器（文件对话框、图片压缩、音频压缩）
 */
import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import fs from 'fs'
import path from 'path'
import ffmpegStaticPath from 'ffmpeg-static'
import { collectFiles, formatSize, backupFile } from './utils/fileUtils.js'
import { compressImage, checkTinypngKey } from './utils/imageUtils.js'
import { compressAudioFile } from './utils/audioUtils.js'

// 注册 local:// 自定义协议（必须在 app ready 之前调用）
// 不设置 standard:true，避免路径被规范化；stream:true 支持音频 range 请求
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local',
    privileges: { secure: true, bypassCSP: true, supportFetchAPI: true, stream: true }
  }
])

// 开发模式使用 ffmpeg-static 包内的二进制；打包后使用随 extraResources 附带的系统二进制
const ffmpegBin = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : ffmpegStaticPath

/**
 * 创建主窗口
 *
 * 开发模式加载 Vite 开发服务器 URL；生产模式加载打包后的 index.html。
 */
function createWindow() {
  const mainWindow = new BrowserWindow({
    title: 'tiny',
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.taosiqi.tiny-app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // local:// 协议：将本地文件路径映射为流式资源，支持音频 range 请求
  protocol.handle('local', (req) => {
    const filePath = decodeURIComponent(req.url.slice('local://'.length))
    return net.fetch(pathToFileURL(filePath).href)
  })

  // ── IPC: dialog ──────────────────────────────────────────────────────────
  ipcMain.handle('dialog:openFiles', async (_, { filters } = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters || []
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  // ── IPC: app ────────────────────────────────────────────────────────────
  ipcMain.handle('app:getVersion', () => app.getVersion())

  // ── IPC: TinyPNG ─────────────────────────────────────────────────────────
  ipcMain.handle('tinypng:checkKey', (_, apiKey) => checkTinypngKey(apiKey))

  // ── IPC: 文件备份还原 ─────────────────────────────────────────────────────
  ipcMain.handle('file:restore', (_, { backupPath, originalPath }) => {
    fs.copyFileSync(backupPath, originalPath)
  })
  ipcMain.handle('file:openInFinder', (_, filePath) => {
    shell.showItemInFolder(filePath)
  })

  // 批量压缩图片：遍历 paths（可为文件或目录），逐张调用 TinyPNG API
  // 每处理一个文件发送 compress:image:progress 事件，全部完成后发送 compress:image:done
  ipcMain.on('compress:image', async (event, { paths, apiKeys, recursive = true }) => {
    const files = []
    for (const p of paths) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        collectFiles(p, ['.png', '.jpg', '.jpeg'], files, recursive)
      } else if (fs.existsSync(p)) {
        files.push(p)
      }
    }
    event.sender.send('compress:image:total', files.length)
    const stats = { total: files.length, processed: 0, skipped: 0, failed: 0, savedBytes: 0 }

    // 本次 batch 内已耗尽（429）的 key 集合，用于自动轮换
    const exhaustedKeys = new Set()

    /** 从未耗尽的 key 中随机选一个，全部耗尽返回 null */
    const pickKey = () => {
      const available = apiKeys.filter((k) => !exhaustedKeys.has(k))
      if (available.length === 0) return null
      return available[Math.floor(Math.random() * available.length)]
    }

    // 用索引遍历，以便在 key 耗尽时能拿到剩余文件列表
    let allKeysExhausted = false

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi]
      let backupPath = null
      try {
        backupPath = backupFile(file)
      } catch (_e) {}
      let key = pickKey()

      // 循环开始时所有 key 已耗尽 → 暂停，告知剩余文件
      if (!key) {
        event.sender.send('compress:image:paused', { remaining: files.slice(fi) })
        allKeysExhausted = true
        break
      }

      let done = false
      while (!done && key) {
        try {
          const result = await compressImage(file, key)
          event.sender.send('compress:image:keycount', {
            key,
            compressionCount: result.compressionCount
          })
          if (result.success) {
            stats.processed++
            stats.savedBytes += result.savedBytes
            event.sender.send('compress:image:progress', {
              file,
              backupPath,
              status: 'success',
              inputSize: formatSize(result.inputSize),
              outputSize: formatSize(result.outputSize),
              inputBytes: result.inputSize,
              outputBytes: result.outputSize,
              saved: formatSize(result.savedBytes)
            })
          } else {
            stats.skipped++
            event.sender.send('compress:image:progress', {
              file,
              backupPath,
              status: 'skipped',
              inputSize: formatSize(result.inputSize),
              outputSize: formatSize(result.outputSize),
              inputBytes: result.inputSize,
              outputBytes: result.outputSize,
              reason: result.reason
            })
          }
          done = true
        } catch (e) {
          if (e.response?.status === 429) {
            // 当前 key 已达上限，加入黑名单后换一个 key 重试
            exhaustedKeys.add(key)
            event.sender.send('compress:image:keycount', { key, compressionCount: 500 })
            key = pickKey()
            if (!key) {
              // 中途耗尽：当前文件也未处理，一并放入剩余列表
              event.sender.send('compress:image:paused', { remaining: files.slice(fi) })
              allKeysExhausted = true
              done = true
            }
            // key 不为 null 则继续 while 循环用新 key 重试
          } else {
            // 非 429 错误（网络、无效 key 等），不重试
            stats.failed++
            event.sender.send('compress:image:progress', {
              file,
              backupPath,
              status: 'error',
              error: e.message
            })
            done = true
          }
        }
      }
      if (allKeysExhausted) break
    }
    // 全部处理完毕才发送 done；key 耗尽暂停时不发送 done
    if (!allKeysExhausted) {
      event.sender.send('compress:image:done', {
        ...stats,
        savedBytes: formatSize(stats.savedBytes)
      })
    }
  })

  // ── IPC: Audio ───────────────────────────────────────────────────────────
  // 批量压缩音频：遍历 paths（可为文件或目录），逐个调用 ffmpeg
  // 每处理一个文件发送 compress:audio:progress 事件，全部完成后发送 compress:audio:done
  ipcMain.on('compress:audio', async (event, { paths, format, recursive = true }) => {
    const ext = format === 'mp3' ? '.mp3' : '.ogg'
    const files = []
    for (const p of paths) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        collectFiles(p, [ext], files, recursive)
      } else if (fs.existsSync(p)) {
        files.push(p)
      }
    }
    event.sender.send('compress:audio:total', files.length)
    const stats = { total: files.length, processed: 0, skipped: 0, failed: 0, savedBytes: 0 }

    for (const file of files) {
      let backupPath = null
      try {
        backupPath = backupFile(file)
      } catch (_e) {}
      try {
        const result = await compressAudioFile(file, format, ffmpegBin)
        if (result.success) {
          stats.processed++
          stats.savedBytes += result.savedBytes
          event.sender.send('compress:audio:progress', {
            file,
            backupPath,
            status: 'success',
            inputSize: formatSize(result.inputSize),
            outputSize: formatSize(result.outputSize),
            inputBytes: result.inputSize,
            outputBytes: result.outputSize,
            saved: formatSize(result.savedBytes)
          })
        } else {
          stats.skipped++
          event.sender.send('compress:audio:progress', {
            file,
            backupPath,
            status: 'skipped',
            inputSize: formatSize(result.inputSize),
            outputSize: formatSize(result.outputSize),
            inputBytes: result.inputSize,
            outputBytes: result.outputSize,
            reason: result.reason
          })
        }
      } catch (e) {
        stats.failed++
        event.sender.send('compress:audio:progress', {
          file,
          backupPath,
          status: 'error',
          error: e.message
        })
      }
    }
    event.sender.send('compress:audio:done', { ...stats, savedBytes: formatSize(stats.savedBytes) })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
