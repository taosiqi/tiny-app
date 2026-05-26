import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { ToastContext } from './toastStateContext'

const TOAST_LIMIT = 3
const DEFAULT_DURATION = 3200
const EXIT_DURATION = 180
const TYPE_LABEL = {
  success: '完成',
  error: '错误',
  warning: '注意',
  info: '提示'
}

let toastId = 0

function nextToastId() {
  toastId += 1
  return `toast-${toastId}`
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())
  const exitTimers = useRef(new Map())

  const remove = useCallback((id) => {
    const exitTimer = exitTimers.current.get(id)
    if (exitTimer) window.clearTimeout(exitTimer)
    exitTimers.current.delete(id)
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const dismiss = useCallback(
    (id) => {
      const timer = timers.current.get(id)
      if (timer) window.clearTimeout(timer)
      timers.current.delete(id)
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: 'leaving' } : item))
      )
      if (!exitTimers.current.has(id)) {
        const exitTimer = window.setTimeout(() => remove(id), EXIT_DURATION)
        exitTimers.current.set(id, exitTimer)
      }
    },
    [remove]
  )

  const notify = useCallback(
    (type, message, options = {}) => {
      if (!message) return null
      const id = nextToastId()
      const duration = options.duration ?? DEFAULT_DURATION
      const item = { id, type, message, status: 'visible' }

      setItems((prev) => [...prev, item].slice(-TOAST_LIMIT))
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }
      return id
    },
    [dismiss]
  )

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current.clear()
      exitTimers.current.forEach((timer) => window.clearTimeout(timer))
      exitTimers.current.clear()
    },
    []
  )

  const value = useMemo(
    () => ({
      dismiss,
      success: (message, options) => notify('success', message, options),
      error: (message, options) => notify('error', message, options),
      warning: (message, options) => notify('warning', message, options),
      info: (message, options) => notify('info', message, options)
    }),
    [dismiss, notify]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" role="status" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast-card toast-${item.type} ${item.status === 'leaving' ? 'toast-leaving' : ''}`}
            onAnimationEnd={(event) => {
              if (event.currentTarget === event.target && item.status === 'leaving') remove(item.id)
            }}
          >
            <div className="min-w-0">
              <div className="toast-label">{TYPE_LABEL[item.type] ?? TYPE_LABEL.info}</div>
              <div className="toast-message">{item.message}</div>
            </div>
            <button
              type="button"
              className="interactive-ghost toast-close"
              aria-label="关闭提示"
              onClick={() => dismiss(item.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

ToastProvider.propTypes = { children: PropTypes.node.isRequired }
