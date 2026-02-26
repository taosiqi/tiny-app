import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import ffmpegStaticPath from 'ffmpeg-static'

// 开发模式使用 ffmpeg-static，打包后使用随包附带的二进制
const ffmpegBin = app.isPackaged
  ? path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : ffmpegStaticPath

// ─── helper: collect files recursively ───────────────────────────────────────
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
function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// ─── TinyPNG: compress one image ─────────────────────────────────────────────
async function compressImage(filePath, apiKey) {
  const fileData = fs.readFileSync(filePath)
  const uploadRes = await axios.post('https://api.tinify.com/shrink', fileData, {
    headers: { 'Content-Type': 'application/octet-stream' },
    auth: { username: 'api', password: apiKey },
    timeout: 30000
  })
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
      savedBytes: input.size - output.size
    }
  }
  return {
    success: false,
    inputSize: input.size,
    outputSize: output.size,
    reason: 'already optimized'
  }
}

// ─── Audio: compress one audio file ──────────────────────────────────────────
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

function createWindow() {
  const mainWindow = new BrowserWindow({
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
  electronApp.setAppUserModelId('com.electron')
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

    for (const file of files) {
      const key = apiKeys[Math.floor(Math.random() * apiKeys.length)]
      try {
        const result = await compressImage(file, key)
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
      } catch (e) {
        stats.failed++
        event.sender.send('compress:image:progress', { file, status: 'error', error: e.message })
      }
    }
    event.sender.send('compress:image:done', { ...stats, savedBytes: formatSize(stats.savedBytes) })
  })

  // ── IPC: Audio ───────────────────────────────────────────────────────────
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
