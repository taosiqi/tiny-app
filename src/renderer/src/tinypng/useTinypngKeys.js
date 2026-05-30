import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkTinypngKey, getTinypngKeys, updateTinypngKeys } from '../api/desktop'

export const KEY_LIMIT = 500

function createEmptyKey() {
  return { value: '', status: 'idle', compressionCount: null, error: null }
}

function normalizeRuntimeKey(key) {
  return {
    value: key?.value ?? '',
    status: key?.status ?? 'idle',
    compressionCount: key?.compressionCount ?? null,
    error: key?.error ?? null
  }
}

export function getValidTinypngKeyValues(keys) {
  return [...keys]
    .filter((key) => key.value.trim())
    .sort((a, b) => {
      const aRemaining = KEY_LIMIT - (a.compressionCount ?? 0)
      const bRemaining = KEY_LIMIT - (b.compressionCount ?? 0)
      return bRemaining - aRemaining
    })
    .map((key) => key.value.trim())
}

export function useTinypngKeys({ autoValidate = false, toast = null } = {}) {
  const [keys, setKeys] = useState([createEmptyKey()])
  const [ready, setReady] = useState(false)
  const autoCheckedRef = useRef(false)
  const suppressPersistRef = useRef(false)
  const sourceIdRef = useRef(`keys-${Math.random().toString(36).slice(2)}`)

  const updateKey = useCallback((index, patch) => {
    setKeys((prev) => prev.map((key, idx) => (idx === index ? { ...key, ...patch } : key)))
  }, [])

  const addKey = useCallback(() => setKeys((prev) => [...prev, createEmptyKey()]), [])
  const removeKey = useCallback(
    (index) => setKeys((prev) => prev.filter((_, idx) => idx !== index)),
    []
  )

  useEffect(() => {
    let active = true

    async function loadKeys() {
      try {
        const stored = await getTinypngKeys()
        const next = stored?.length ? stored.map(normalizeRuntimeKey) : null

        if (active && next?.length) {
          const restored = next.map((key) => ({ ...key, status: 'idle', error: null }))
          const snapshot = restored
            .map((key, index) => ({ ...key, index, value: key.value.trim() }))
            .filter((key) => key.value)

          setKeys(
            restored.map((key, index) =>
              autoValidate && snapshot.some((item) => item.index === index)
                ? { ...key, status: 'checking' }
                : key
            )
          )

          if (autoValidate && !autoCheckedRef.current && snapshot.length > 0) {
            autoCheckedRef.current = true
            const results = await Promise.all(
              snapshot.map(async (key) => {
                try {
                  const result = await checkTinypngKey(key.value)
                  return { key, result }
                } catch (error) {
                  return {
                    key,
                    result: {
                      valid: false,
                      compressionCount: null,
                      error: error?.message ?? String(error)
                    }
                  }
                }
              })
            )

            if (active) {
              setKeys((prev) =>
                prev.map((key, index) => {
                  const checked = results.find((item) => item.key.index === index)
                  if (!checked) return key
                  const { result } = checked
                  return {
                    ...key,
                    status: result.valid ? 'valid' : 'invalid',
                    compressionCount: result.compressionCount,
                    error: result.error || null
                  }
                })
              )
              const validCount = results.filter((item) => item.result.valid).length
              if (validCount > 0)
                toast?.success(`自动校验完成：${validCount}/${snapshot.length} 个 Key 可用`)
              else toast?.error('自动校验完成：没有可用 Key')
            }
          }
        }

      } catch (error) {
        console.error('[tinypng] failed to load stored keys', error)
      } finally {
        if (active) setReady(true)
      }
    }

    loadKeys()
    return () => {
      active = false
    }
  }, [autoValidate, toast])

  useEffect(() => {
    const onKeysUpdated = (event) => {
      if (event.detail?.source === sourceIdRef.current) return
      if (!Array.isArray(event.detail?.keys)) return
      suppressPersistRef.current = true
      setKeys(event.detail.keys.map(normalizeRuntimeKey))
    }
    window.addEventListener('tinypress:keys-updated', onKeysUpdated)
    return () => window.removeEventListener('tinypress:keys-updated', onKeysUpdated)
  }, [])

  useEffect(() => {
    if (!ready) return
    if (suppressPersistRef.current) {
      suppressPersistRef.current = false
      return
    }
    const toStore = keys.map(({ value, compressionCount }) => ({ value, compressionCount }))
    updateTinypngKeys(toStore)
      .then((persisted) => {
        const nextKeys = Array.isArray(persisted) ? persisted : toStore
        window.dispatchEvent(
          new CustomEvent('tinypress:keys-updated', {
            detail: { source: sourceIdRef.current, keys: nextKeys.map(normalizeRuntimeKey) }
          })
        )
      })
      .catch((error) => console.error('[tinypng] failed to persist keys', error))
  }, [keys, ready])

  const checkKey = useCallback(
    async (index, valueOverride = null) => {
      const keyVal = (valueOverride ?? keys[index]?.value ?? '').trim()
      if (!keyVal) return false
      updateKey(index, { status: 'checking', error: null })
      try {
        const result = await checkTinypngKey(keyVal)
        if (result.valid) {
          updateKey(index, {
            status: 'valid',
            compressionCount: result.compressionCount,
            error: result.error || null
          })
          toast?.success(`Key 可用，剩余 ${KEY_LIMIT - result.compressionCount} 次`)
          return true
        }
        updateKey(index, { status: 'invalid', error: result.error })
        toast?.error(result.error || 'Key 校验失败')
        return false
      } catch (error) {
        updateKey(index, { status: 'invalid', error: error?.message ?? String(error) })
        toast?.error(`Key 校验失败：${error?.message ?? error}`)
        return false
      }
    },
    [keys, toast, updateKey]
  )

  const checkAllKeys = useCallback(async () => {
    const snapshot = keys
      .map((key, index) => ({ ...key, index, value: key.value.trim() }))
      .filter((key) => key.value)
    if (snapshot.length === 0) {
      toast?.warning('请先填写 TinyPNG API Key')
      return 0
    }
    snapshot.forEach((key) => updateKey(key.index, { status: 'checking', error: null }))
    const results = await Promise.all(
      snapshot.map(async (key) => {
        try {
          const result = await checkTinypngKey(key.value)
          updateKey(key.index, {
            status: result.valid ? 'valid' : 'invalid',
            compressionCount: result.compressionCount,
            error: result.error || null
          })
          return result.valid
        } catch (error) {
          updateKey(key.index, {
            status: 'invalid',
            compressionCount: null,
            error: error?.message ?? String(error)
          })
          return false
        }
      })
    )
    const validCount = results.filter(Boolean).length
    if (validCount > 0) toast?.success(`校验完成：${validCount}/${snapshot.length} 个 Key 可用`)
    else toast?.error('校验完成：没有可用 Key')
    return validCount
  }, [keys, toast, updateKey])

  const validKeyValues = useMemo(() => getValidTinypngKeyValues(keys), [keys])

  return {
    keys,
    setKeys,
    ready,
    addKey,
    removeKey,
    updateKey,
    checkKey,
    checkAllKeys,
    validKeyValues
  }
}
