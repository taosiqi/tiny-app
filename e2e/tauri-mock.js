export async function installTauriMock(page) {
  await page.addInitScript(() => {
    const listeners = new Map()
    const callbacks = new Map()
    const calls = []
    let nextCallbackId = 1
    let nextEventId = 1

    const state = {
      settings: {
        nightMode: 'system',
        closeBehavior: 'background',
        backupDirName: '_tiny_backup',
        compression: {
          image: { recursiveScan: true },
          audio: {
            recursiveScan: true,
            mp3: { bitrate: '96k', sampleRate: 44100, channels: 2 },
            ogg: { bitrate: '96k', sampleRate: 44100, channels: 2 },
            wav: { sampleRate: 22050, channels: 2 }
          }
        }
      },
      keys: [{ value: 'stored-key', compressionCount: null }],
      openFiles: ['/tmp/photo.png'],
      openDirectories: ['/tmp/images'],
      calls
    }

    function emit(event, payload) {
      for (const listener of listeners.values()) {
        if (listener.event === event) {
          const callback = callbacks.get(listener.handler)
          callback?.({ event, payload, id: listener.id })
        }
      }
    }

    async function invoke(command, args = {}) {
      calls.push({ command, args })
      if (command === 'get_app_version') return '2.1.0'
      if (command === 'get_runtime_health') {
        return {
          appVersion: '2.1.0',
          ffmpegPath: '/tmp/ffmpeg',
          ffmpegExists: true,
          ffmpegAvailable: true,
          backupDirName: state.settings.backupDirName,
          tinypngKeyCount: state.keys.filter((key) => key.value.trim()).length
        }
      }
      if (command === 'get_app_settings') return state.settings
      if (command === 'update_app_settings') {
        state.settings = { ...state.settings, ...args.settings }
        return state.settings
      }
      if (command === 'sync_window_theme' || command === 'plugin:app|set_app_theme') return null
      if (command === 'get_tinypng_keys') return state.keys
      if (command === 'update_tinypng_keys') {
        state.keys = args.keys
        return state.keys
      }
      if (command === 'check_tinypng_key') {
        return { valid: true, compressionCount: 12, remaining: 488, error: null }
      }
      if (command === 'plugin:dialog|open') {
        return args.options?.directory ? state.openDirectories : state.openFiles
      }
      if (command === 'compress_image') {
        setTimeout(() => emit('compress:image:total', 1), 0)
        setTimeout(
          () =>
            emit('compress:image:progress', {
              status: 'success',
              file: '/tmp/photo.png',
              backupPath: '/tmp/_tiny_backup/photo.png',
              inputBytes: 2048,
              outputBytes: 1024,
              inputSize: '2 KB',
              outputSize: '1 KB',
              saved: '1 KB',
              format: 'png'
            }),
          5
        )
        setTimeout(
          () =>
            emit('compress:image:done', {
              total: 1,
              processed: 1,
              skipped: 0,
              failed: 0,
              savedBytes: '1 KB'
            }),
          10
        )
        return null
      }
      if (command === 'get_backup_status') {
        return {
          originalPath: args.payload.originalPath,
          backupPath: args.payload.backupPath,
          originalExists: true,
          backupExists: true,
          originalSize: '1 KB',
          backupSize: '2 KB',
          originalBytes: 1024,
          backupBytes: 2048,
          originalModified: 1700000000,
          backupModified: 1700000000
        }
      }
      if (command === 'get_file_metadata') {
        return {
          path: args.filePath,
          name: args.filePath.split('/').pop(),
          kind: args.filePath.endsWith('.png') ? 'image' : 'text',
          exists: true,
          size: '1 KB',
          bytes: 1024,
          modified: 1700000000,
          image: args.filePath.endsWith('.png') ? { width: 100, height: 80 } : null,
          audio: null
        }
      }
      if (command === 'delete_backup_file') return null
      if (command === 'open_external') return null
      if (command === 'plugin:event|listen') {
        const id = nextEventId++
        listeners.set(id, { id, event: args.event, handler: args.handler })
        return id
      }
      if (command === 'plugin:event|unlisten') {
        listeners.delete(args.eventId)
        return null
      }
      return null
    }

    window.__E2E_TAURI__ = state
    window.__TAURI_INTERNALS__ = {
      invoke,
      convertFileSrc: (path) => `asset://${path}`,
      transformCallback: (callback) => {
        const id = nextCallbackId++
        callbacks.set(id, callback)
        return id
      },
      unregisterCallback: (id) => callbacks.delete(id)
    }
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event, eventId) => listeners.delete(eventId)
    }
  })
}
