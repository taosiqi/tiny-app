import { useEffect } from 'react'
import PropTypes from 'prop-types'
import ComparePanel from './ComparePanel'

export default function CompareFullscreen({ logs, onClose }) {
  const successCount = logs.filter((item) => item.status === 'success').length

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--app-bg)] text-stone-900">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 px-6 py-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-stone-400">Compare Workspace</div>
          <h2 className="mt-1 text-xl font-black text-stone-950">
            压缩对比 <span className="compare-count-badge ml-2">{successCount}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="interactive-ghost rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-600"
        >
          关闭
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden p-5">
        <ComparePanel logs={logs} fullscreen />
      </main>
    </div>
  )
}

CompareFullscreen.propTypes = {
  logs: PropTypes.array.isRequired,
  onClose: PropTypes.func.isRequired
}
