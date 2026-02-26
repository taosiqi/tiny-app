/**
 * @file main/index.js
 * @description Electron 主进程入口
 *
 * 负责：
 *  - 创建 BrowserWindow 并加载渲染层
 *  - 注册 IPC 处理器（文件对话框、图片压缩、音频压缩）
 *  - 调用 TinyPNG API 执行图片压缩
 *  - 调用 ffmpeg 执行音频压缩
 */
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import ffmpegStaticPath from 'ffmpeg-static'

// 开发模式使用 ffmpeg-static 包内的二进制；打包后使用随 extraResources 附带的系统二进制
const ffmpegBin = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : ffmpegStaticPath

// ─── helper: collect files recursively ───────────────────────────────────────
/**
 * 递归收集目录下所有匹配扩展名的文件路径
 * @param {string} dir     - 起始目录
 * @param {string[]} exts  - 允许的文件扩展名（如 ['.png', '.jpg']）
 * @param {string[]} results - 结果数组，收集到的路径追加至此
 */
function collectFiles(dir, exts, results) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, exts, results)
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
}

// ─── helper: format bytes ────────────────────────────────────────────────────
/**
 * 将字节数格式化为人类可读的字符串（B / KB / MB / GB）
 * @param {number} bytes
 * @returns {string} 如 "1.23 MB"
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// ─── TinyPNG: compress one image ─────────────────────────────────────────────
/**
 * 通过 TinyPNG API 压缩单张图片（原地覆盖）
 *
 * 流程：先将文件 POST 到 /shrink，若压缩后体积更小则下载并覆写源文件。
 * 若压缩后体积不小于原始大小则跳过，不覆写文件。
 *
 * @param {string} filePath - 图片的本地绝对路径
 * @param {string} apiKey   - TinyPNG API Key
 * @returns {Promise<{success: boolean, inputSize: number, outputSize: number, savedBytes?: number, compressionCount: number, reason?: string}>}
 */
async function compressImage(filePath, apiKey) {
  const fileData = fs.readFileSync(filePath)
  const uploadRes = await axios.post('https://api.tinify.com/shrink', fileData, {
    headers: { 'Content-Type': 'application/octet-stream' },
    auth: { username: 'api', password: apiKey },
    timeout: 30000
  })
  const compressionCount = parseInt(uploadRes.headers['compression-count'] || '0', 10)
  const { input, output } = uploadRes.data
  if (output.size < input.size) {
    const dlRes = await axios.get(output.url, {
      responseType: 'arraybuffer',
      auth: { username: 'api', password: apiKey },
      timeout: 30000
    })
    fs.writeFileSync(filePath, Buffer.from(dlRes.data))
    return {
      success: true,
      inputSize: input.size,
      outputSize: output.size,
      savedBytes: input.size - output.size,
      compressionCount
    }
  }
  return {
    success: false,
    inputSize: input.size,
    outputSize: output.size,
    reason: 'already optimized',
    compressionCount
  }
}

// ─── TinyPNG: check key validity & usage ─────────────────────────────────────
// 用一张合法的 1×1 PNG 探测 key 有效性并获取当月已使用次数（compression-count）
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)
/**
 * 检查 TinyPNG API Key 的有效性及当月剩余配额
 *
 * HTTP 200/201 → key 有效；401 → key 无效；429 → 已达当月 500 次上限。
 *
 * @param {string} apiKey
 * @returns {Promise<{valid: boolean, compressionCount?: number, remaining?: number, error?: string}>}
 */
async function checkTinypngKey(apiKey) {
  try {
    const res = await axios.post('https://api.tinify.com/shrink', TINY_PNG, {
      headers: { 'Content-Type': 'application/octet-stream' },
      auth: { username: 'api', password: apiKey },
      timeout: 15000,
      validateStatus: (s) => s === 200 || s === 201
    })
    const compressionCount = parseInt(res.headers['compression-count'] || '0', 10)
    return { valid: true, compressionCount, remaining: 500 - compressionCount }
  } catch (e) {
    const status = e.response?.status
    if (status === 401) return { valid: false, error: 'API Key 无效' }
    if (status === 429) {
      const compressionCount = parseInt(e.response?.headers?.['compression-count'] ?? '500', 10)
      return { valid: true, compressionCount, remaining: 0, error: '当月已达上限' }
    }
    if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
      return { valid: false, error: '请求超时，请检查网络' }
    }
    return { valid: false, error: '网络错误：' + (e.response?.data?.message || e.message) }
  }
}

// ─── Audio: compress one audio file ──────────────────────────────────────────
/**
 * 使用 ffmpeg 压缩单个音频文件（原地覆盖）
 *
 * MP3：输出 64kbps 单声道 44.1kHz
 * OGG：输出 libvorbis 96kbps 44.1kHz
 *
 * 流程：先写入同目录临时文件，若压缩后体积更小则覆写源文件，否则删除临时文件。
 *
 * @param {string} filePath - 音频文件的本地绝对路径
 * @param {'mp3'|'ogg'} format
 * @returns {Promise<{success: boolean, inputSize: number, outputSize: number, savedBytes?: number, reason?: string}>}
 */
function compressAudioFile(filePath, format) {
  return new Promise((resolve, reject) => {
    const originalSize = fs.statSync(filePath).size
    const tempFile = filePath + '.tmp' + (format === 'mp3' ? '.mp3' : '.ogg')
    const args =
      format === 'mp3'
        ? [
            '-i',
            filePath,
            '-b:a',
            '64k',
            '-acodec',
            'mp3',
            '-ar',
            '44100',
            '-ac',
            '1',
            tempFile,
            '-y'
          ]
        : ['-i', filePath, '-c:a', 'libvorbis', '-b:a', '96k', '-ar', '44100', tempFile, '-y']

    const child = spawn(ffmpegBin, args, { stdio: 'pipe' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
        return reject(new Error('ffmpeg failed with code ' + code))
      }
      const compressedSize = fs.statSync(tempFile).size
      if (compressedSize < originalSize) {
        fs.copyFileSync(tempFile, filePath)
        fs.unlinkSync(tempFile)
        resolve({
          success: true,
          inputSize: originalSize,
          outputSize: compressedSize,
          savedBytes: originalSize - compressedSize
        })
      } else {
        fs.unlinkSync(tempFile)
        resolve({
          success: false,
          inputSize: originalSize,
          outputSize: compressedSize,
          reason: 'no size reduction'
        })
      }
    })
  })
}

/**
 * 创建主窗口
 *
 * 开发模式加载 Vite 开发服务器 URL；生产模式加载打包后的 index.html。
 */
function createWindow() {
  const mainWindow = new BrowserWindow({
    title: 'Tiny App',
    width: 960,
    height: 700,
    minWidth: 760,
    minHeight: 560,
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

  // ── IPC: TinyPNG ─────────────────────────────────────────────────────────
  ipcMain.handle('tinypng:checkKey', (_, apiKey) => checkTinypngKey(apiKey))

  // 批量压缩图片：遍历 paths（可为文件或目录），逐张调用 TinyPNG API
  // 每处理一个文件发送 compress:image:progress 事件，全部完成后发送 compress:image:done
  ipcMain.on('compress:image', async (event, { paths, apiKeys }) => {
    const files = []
    for (const p of paths) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        collectFiles(p, ['.png', '.jpg', '.jpeg'], files)
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

    for (const file of files) {
      let key = pickKey()

      // 所有 key 均已耗尽，直接标记失败
      if (!key) {
        stats.failed++
        event.sender.send('compress:image:progress', {
          file,
          status: 'error',
          error: '所有 API Key 已达当月上限'
        })
        continue
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
              status: 'success',
              inputSize: formatSize(result.inputSize),
              outputSize: formatSize(result.outputSize),
              saved: formatSize(result.savedBytes)
            })
          } else {
            stats.skipped++
            event.sender.send('compress:image:progress', {
              file,
              status: 'skipped',
              inputSize: formatSize(result.inputSize),
              outputSize: formatSize(result.outputSize),
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
              // 没有可用 key 了
              stats.failed++
              event.sender.send('compress:image:progress', {
                file,
                status: 'error',
                error: '所有 API Key 已达当月上限'
              })
              done = true
            }
            // key 不为 null 则继续 while 循环用新 key 重试
          } else {
            // 非 429 错误（网络、无效 key 等），不重试
            stats.failed++
            event.sender.send('compress:image:progress', {
              file,
              status: 'error',
              error: e.message
            })
            done = true
          }
        }
      }
    }
    event.sender.send('compress:image:done', { ...stats, savedBytes: formatSize(stats.savedBytes) })
  })

  // ── IPC: Audio ───────────────────────────────────────────────────────────
  // 批量压缩音频：遍历 paths（可为文件或目录），逐个调用 ffmpeg
  // 每处理一个文件发送 compress:audio:progress 事件，全部完成后发送 compress:audio:done
  ipcMain.on('compress:audio', async (event, { paths, format }) => {
    const ext = format === 'mp3' ? '.mp3' : '.ogg'
    const files = []
    for (const p of paths) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        collectFiles(p, [ext], files)
      } else if (fs.existsSync(p)) {
        files.push(p)
      }
    }
    event.sender.send('compress:audio:total', files.length)
    const stats = { total: files.length, processed: 0, skipped: 0, failed: 0, savedBytes: 0 }

    for (const file of files) {
      try {
        const result = await compressAudioFile(file, format)
        if (result.success) {
          stats.processed++
          stats.savedBytes += result.savedBytes
          event.sender.send('compress:audio:progress', {
            file,
            status: 'success',
            inputSize: formatSize(result.inputSize),
            outputSize: formatSize(result.outputSize),
            saved: formatSize(result.savedBytes)
          })
        } else {
          stats.skipped++
          event.sender.send('compress:audio:progress', {
            file,
            status: 'skipped',
            inputSize: formatSize(result.inputSize),
            outputSize: formatSize(result.outputSize),
            reason: result.reason
          })
        }
      } catch (e) {
        stats.failed++
        event.sender.send('compress:audio:progress', { file, status: 'error', error: e.message })
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
