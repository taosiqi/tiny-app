import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { setTheme } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-dialog'

function subscribe(channel, cb) {
  let active = true
  const unlistenPromise = listen(channel, (event) => {
    if (active) cb(event.payload)
  })

  return () => {
    active = false
    unlistenPromise.then((unlisten) => unlisten()).catch(() => {})
  }
}

function runCommand(command, payload) {
  return invoke(command, payload)
}

export async function openFiles(options = {}) {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: options.filters ?? []
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

export async function openDirectory() {
  const selected = await open({ multiple: false, directory: true })
  return Array.isArray(selected) ? (selected[0] ?? null) : selected
}

export const openExternal = (url) => invoke('open_external', { url })
export const getAppVersion = () => invoke('get_app_version')
export const getAppSettings = () => invoke('get_app_settings')
export const updateAppSettings = (settings) => invoke('update_app_settings', { settings })
export const updateNativeTheme = (theme) => setTheme(theme)
export const syncWindowTheme = (mode) => invoke('sync_window_theme', { mode })
export const getTinypngKeys = () => invoke('get_tinypng_keys')
export const updateTinypngKeys = (keys) => invoke('update_tinypng_keys', { keys })
export const checkTinypngKey = (apiKey) => invoke('check_tinypng_key', { apiKey })
export const compressImage = (payload) => runCommand('compress_image', { payload })
export const stopImageCompression = () => invoke('stop_image_compression')
export const compressAudio = (payload) => runCommand('compress_audio', { payload })
export const stopAudioCompression = () => invoke('stop_audio_compression')
export const getBackupStatus = (payload) => invoke('get_backup_status', { payload })
export const getFileMetadata = (filePath) => invoke('get_file_metadata', { filePath })
export const compareFiles = (leftPath, rightPath) =>
  invoke('compare_files', { payload: { leftPath, rightPath } })
export const restoreFile = (backupPath, originalPath) =>
  invoke('restore_file', { payload: { backupPath, originalPath } })
export const deleteBackupFile = (backupPath, originalPath) =>
  invoke('delete_backup_file', { payload: { backupPath, originalPath } })
export const openInFinder = (filePath) => invoke('open_in_finder', { filePath })

export const onImageTotal = (cb) => subscribe('compress:image:total', cb)
export const onImageProgress = (cb) => subscribe('compress:image:progress', cb)
export const onImageKeyCount = (cb) => subscribe('compress:image:keycount', cb)
export const onImageDone = (cb) => subscribe('compress:image:done', cb)
export const onImagePaused = (cb) => subscribe('compress:image:paused', cb)
export const onAudioTotal = (cb) => subscribe('compress:audio:total', cb)
export const onAudioProgress = (cb) => subscribe('compress:audio:progress', cb)
export const onAudioDone = (cb) => subscribe('compress:audio:done', cb)
export const onAudioPaused = (cb) => subscribe('compress:audio:paused', cb)
export const onOpenSettings = (cb) => subscribe('app:navigate-settings', cb)
