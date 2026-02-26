/**
 * @file preload/index.js
 * @description Electron 预加载脚本
 *
 * 在沙盒化的渲染进程中运行，通过 contextBridge 将安全的 IPC 接口
 * 暴露为 `window.api`，让渲染层无需直接访问 Node.js 或 Electron 内部模块。
 *
 * 注意：每个事件监听器的注册函数均返回一个"取消监听"的清理函数，
 * 调用方在组件卸载或任务完成后应及时调用，避免监听器泄漏。
 */
import { contextBridge, ipcRenderer, shell } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // ── 通用工具 ─────────────────────────────────────────────────────────────
  /** 使用系统默认浏览器打开外部链接 */
  openExternal: (url) => shell.openExternal(url),

  // ── 文件对话框 ────────────────────────────────────────────────────────────
  /** 打开文件选择对话框，返回选中的文件路径数组 */
  openFiles: (options) => ipcRenderer.invoke('dialog:openFiles', options),
  /** 打开目录选择对话框，返回所选目录路径（单个字符串）或 null */
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // ── 图片压缩（TinyPNG） ───────────────────────────────────────────────────
  /** 校验 TinyPNG API Key 有效性及当月剩余额度 */
  checkTinypngKey: (key) => ipcRenderer.invoke('tinypng:checkKey', key),
  /** 触发图片批量压缩（单向发送，结果通过事件回调） */
  compressImage: (payload) => ipcRenderer.send('compress:image', payload),
  /** 订阅"文件总数"事件，返回清理函数 */
  onImageTotal: (cb) => {
    ipcRenderer.on('compress:image:total', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:total')
  },
  /** 订阅"单文件处理结果"事件，返回清理函数 */
  onImageProgress: (cb) => {
    ipcRenderer.on('compress:image:progress', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:progress')
  },
  /** 订阅"API Key 当月使用次数更新"事件，返回清理函数 */
  onImageKeyCount: (cb) => {
    ipcRenderer.on('compress:image:keycount', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:keycount')
  },
  /** 订阅"全部图片处理完毕"事件，返回清理函数 */
  onImageDone: (cb) => {
    ipcRenderer.on('compress:image:done', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:done')
  },

  // ── 音频压缩（ffmpeg） ────────────────────────────────────────────────────
  /** 触发音频批量压缩（单向发送，结果通过事件回调） */
  compressAudio: (payload) => ipcRenderer.send('compress:audio', payload),
  /** 订阅"音频文件总数"事件，返回清理函数 */
  onAudioTotal: (cb) => {
    ipcRenderer.on('compress:audio:total', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:audio:total')
  },
  /** 订阅"单音频文件处理结果"事件，返回清理函数 */
  onAudioProgress: (cb) => {
    ipcRenderer.on('compress:audio:progress', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:audio:progress')
  },
  /** 订阅"全部音频处理完毕"事件，返回清理函数 */
  onAudioDone: (cb) => {
    ipcRenderer.on('compress:audio:done', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:audio:done')
  },

  // ── 通用清理 ──────────────────────────────────────────────────────────────
  /** 移除指定 IPC 频道的所有监听器 */
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
