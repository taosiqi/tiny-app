import { NavLink } from 'react-router-dom'
import PropTypes from 'prop-types'
import { NAV_ITEMS } from '../config/navigation'

export default function Sidebar({ appVersion }) {
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date())

  return (
    <aside className="app-sidebar w-72 shrink-0 rounded-[2rem] border border-white/60 bg-white/70 p-4 shadow-[0_24px_80px_rgba(30,41,59,0.16)] backdrop-blur-2xl">
      <div className="brand-card rounded-[1.5rem] px-5 py-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <span className="rounded-full border border-stone-200 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">
            Tauri
          </span>
          <span className="text-xs text-stone-400">v{appVersion}</span>
        </div>
        <h1 className="text-3xl font-black leading-none tracking-tight">TinyPress</h1>
        <p className="mt-2 text-sm leading-5 text-stone-500">图片与音频压缩工作台</p>
      </div>

      <nav className="mt-4 space-y-2">
        {NAV_ITEMS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-200 ${
                isActive
                  ? 'nav-active'
                  : 'border-stone-200 bg-transparent text-stone-500 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--theme-accent)_36%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-accent)_6%,transparent)] hover:text-stone-800'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`nav-kicker w-8 shrink-0 text-[11px] font-black tracking-tight ${
                    isActive ? 'text-[var(--theme-ink)]' : 'text-stone-400 group-hover:text-stone-700'
                  }`}
                >
                  {tab.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{tab.label}</span>
                  <span className={`nav-desc block truncate text-xs ${isActive ? '' : 'text-stone-400'}`}>
                    {tab.desc}
                  </span>
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto pt-4">
        <div className="rounded-2xl px-2 py-3 text-xs text-stone-500">
          <div className="flex items-center justify-between">
            <span>今日</span>
            <span className="font-semibold text-stone-900">{today}</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

Sidebar.propTypes = {
  appVersion: PropTypes.string.isRequired
}
