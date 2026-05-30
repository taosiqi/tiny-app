import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import {
  getAppSettings,
  syncWindowTheme,
  updateAppSettings,
  updateNativeTheme
} from '../api/desktop'
import { SettingsContext } from './settingsStateContext'
import { cloneCompression, DEFAULT_COMPRESSION } from './compressionSettings'

const DEFAULT_SETTINGS = {
  nightMode: 'system',
  closeBehavior: 'background',
  backupDirName: '_tiny_backup',
  compression: DEFAULT_COMPRESSION
}

function normalizeClientSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    compression: cloneCompression(settings.compression)
  }
}

const getResolvedNightMode = (mode) => {
  if (mode === 'dark') return 'dark'
  if (mode === 'light') return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    getAppSettings()
      .then((next) => {
        if (active) setSettings(normalizeClientSettings(next))
      })
      .catch(() => {})
      .finally(() => {
        if (active) setReady(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const applyNightMode = () => {
      const resolved = getResolvedNightMode(settings.nightMode)
      document.documentElement.dataset.night = resolved
      document.documentElement.dataset.nightMode = settings.nightMode
      updateNativeTheme(settings.nightMode === 'system' ? null : resolved).catch((error) => {
        console.error('[settings] failed to sync native theme', error)
      })
      syncWindowTheme(resolved).catch((error) => {
        console.error('[settings] failed to sync window theme', error)
      })
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')

    applyNightMode()
    media?.addEventListener('change', applyNightMode)

    return () => media?.removeEventListener('change', applyNightMode)
  }, [settings.nightMode])

  const saveSettings = useCallback(
    async (patch) => {
      const previous = settings
      const optimistic = { ...settings, ...patch }
      setSettings(optimistic)

      try {
        const persisted = await updateAppSettings(optimistic)
        setSettings(normalizeClientSettings(persisted))
      } catch (error) {
        console.error('[settings] failed to persist settings', error)
        setSettings(previous)
        throw error
      }
    },
    [settings]
  )

  const value = useMemo(() => ({ settings, ready, saveSettings }), [ready, saveSettings, settings])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

SettingsProvider.propTypes = { children: PropTypes.node.isRequired }
