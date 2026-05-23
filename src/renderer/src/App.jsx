/**
 * @file App.jsx
 * @description 应用根组件：Tauri + React 的现代桌面布局。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  HashRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
  useOutlet
} from 'react-router-dom'
import { KeepAlive } from 'keepalive-for-react'
import TinyPNG from './components/TinyPNG'
import AudioTool from './components/AudioTool'
import { getAppVersion } from './api/desktop'

const TABS = [
  { path: '/png', label: '图片压缩', icon: 'PNG', desc: 'TinyPNG 批量优化' },
  { path: '/mp3', label: 'MP3 压缩', icon: 'MP3', desc: '64kbps 单声道' },
  { path: '/ogg', label: 'OGG 压缩', icon: 'OGG', desc: 'Vorbis 96kbps' },
  { path: '/wav', label: 'WAV 压缩', icon: 'WAV', desc: '22.05kHz 重编码' }
]

function KeepAliveLayout() {
  const location = useLocation()
  const outlet = useOutlet()
  const currentCacheKey = useMemo(
    () => location.pathname + location.search,
    [location.pathname, location.search]
  )

  return (
    <KeepAlive activeCacheKey={currentCacheKey} max={5}>
      {outlet}
    </KeepAlive>
  )
}

function AppShell() {
  const [appVersion, setAppVersion] = useState('...')
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    weekday: 'short'
  }).format(new Date())

  useEffect(() => {
    let active = true
    getAppVersion()
      .then((version) => {
        if (active && version) setAppVersion(version)
      })
      .catch(() => {
        if (active) setAppVersion('unknown')
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="app-shell h-screen w-screen overflow-hidden text-stone-900 select-none">
      <div className="absolute inset-0 app-ambient" />
      <div className="relative z-10 flex h-full gap-5 p-5">
        <aside className="app-sidebar w-72 shrink-0 rounded-[2rem] border border-white/60 bg-white/70 p-4 shadow-[0_24px_80px_rgba(30,41,59,0.16)] backdrop-blur-2xl">
          <div className="rounded-[1.5rem] bg-stone-950 px-5 py-5 text-white shadow-xl shadow-stone-950/20">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-300">
                Tauri
              </span>
              <span className="text-xs text-stone-400">v{appVersion}</span>
            </div>
            <h1 className="text-3xl font-black leading-none tracking-tight">TinyPress</h1>
            <p className="mt-2 text-sm leading-5 text-stone-300">图片与音频压缩工作台</p>
          </div>

          <nav className="mt-4 space-y-2">
            {TABS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-200 ${
                    isActive
                      ? 'border-stone-900 bg-stone-950 text-white shadow-xl shadow-stone-900/15'
                      : 'border-transparent bg-white/55 text-stone-600 hover:-translate-y-0.5 hover:border-white hover:bg-white hover:text-stone-950 hover:shadow-lg hover:shadow-stone-900/8'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`grid h-11 w-11 place-items-center rounded-2xl text-[11px] font-black tracking-tight ${
                        isActive
                          ? 'bg-lime-300 text-stone-950'
                          : 'bg-stone-100 text-stone-500 group-hover:bg-lime-100 group-hover:text-stone-950'
                      }`}
                    >
                      {tab.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{tab.label}</span>
                      <span className={`block truncate text-xs ${isActive ? 'text-stone-300' : 'text-stone-400'}`}>
                        {tab.desc}
                      </span>
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto pt-4">
            <div className="rounded-3xl border border-white/70 bg-white/55 p-4 text-xs text-stone-500 shadow-inner shadow-white/40">
              <div className="flex items-center justify-between">
                <span>今日</span>
                <span className="font-semibold text-stone-900">{today}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span>状态栏</span>
                <span className="font-semibold text-emerald-700">已启用</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/62 shadow-[0_24px_80px_rgba(30,41,59,0.12)] backdrop-blur-2xl">
          <header className="flex shrink-0 items-center justify-between border-b border-stone-200/70 px-7 py-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.26em] text-stone-400">Compression Desk</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-stone-950">把文件瘦身，别把流程变复杂</h2>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-stone-200 bg-white/70 px-4 py-2 text-xs font-semibold text-stone-500 shadow-sm md:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" />
              Rust 后台就绪
            </div>
          </header>

          <section className="min-h-0 flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/png" replace />} />
              <Route element={<KeepAliveLayout />}>
                <Route path="/png" element={<TinyPNG />} />
                <Route path="/mp3" element={<AudioTool format="mp3" />} />
                <Route path="/ogg" element={<AudioTool format="ogg" />} />
                <Route path="/wav" element={<AudioTool format="wav" />} />
              </Route>
            </Routes>
          </section>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}
