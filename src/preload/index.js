import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // dialogs
  openFiles: (options) => ipcRenderer.invoke('dialog:openFiles', options),
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),

  // image compression
  compressImage: (payload) => ipcRenderer.send('compress:image', payload),
  onImageTotal: (cb) => {
    ipcRenderer.on('compress:image:total', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:total')
  },
  onImageProgress: (cb) => {
    ipcRenderer.on('compress:image:progress', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:progress')
  },
  onImageDone: (cb) => {
    ipcRenderer.on('compress:image:done', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:image:done')
  },

  // audio compression
  compressAudio: (payload) => ipcRenderer.send('compress:audio', payload),
  onAudioTotal: (cb) => {
    ipcRenderer.on('compress:audio:total', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:audio:total')
  },
  onAudioProgress: (cb) => {
    ipcRenderer.on('compress:audio:progress', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:audio:progress')
  },
  onAudioDone: (cb) => {
    ipcRenderer.on('compress:audio:done', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('compress:audio:done')
  },

  // remove all listeners for a channel
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
