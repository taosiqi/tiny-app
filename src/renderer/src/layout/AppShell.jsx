import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import TinyPNG from '../components/TinyPNG'
import AudioTool from '../components/AudioTool'
import FileCompare from '../components/FileCompare'
import Settings from '../components/Settings'
import { getAppVersion, onOpenSettings } from '../api/desktop'
import KeepAliveLayout from './KeepAliveLayout'
import Sidebar from './Sidebar'

export default function AppShell() {
  const [appVersion, setAppVersion] = useState('...')
  const navigate = useNavigate()

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

  useEffect(() => onOpenSettings(() => navigate('/settings')), [navigate])

  return (
    <div className="app-shell h-screen w-screen overflow-hidden text-stone-900 select-none">
      <div className="absolute inset-0 app-ambient" />
      <div className="relative z-10 flex h-full gap-5 p-5">
        <Sidebar appVersion={appVersion} />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/62 shadow-[0_24px_80px_rgba(30,41,59,0.12)] backdrop-blur-2xl">
          <header className="flex shrink-0 items-center justify-between border-b border-stone-200/70 px-7 py-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.26em] text-stone-400">Compression Desk</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight text-stone-950">把文件瘦身，别把流程变复杂</h2>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-stone-200 bg-white/70 px-4 py-2 text-xs font-semibold text-stone-500 shadow-sm md:flex">
              <span className="h-2 w-2 rounded-full bg-[var(--theme-accent)] shadow-[0_0_0_4px_var(--theme-ring)]" />
              Rust 后台就绪
            </div>
          </header>

          <section className="min-h-0 flex-1 overflow-hidden">
            <Routes>
                <Route path="/" element={<Navigate to="/png" replace />} />
                <Route element={<KeepAliveLayout />}>
                  <Route path="/png" element={<TinyPNG />} />
                <Route path="/audio" element={<AudioTool />} />
                <Route path="/mp3" element={<Navigate to="/audio?format=mp3" replace />} />
                <Route path="/ogg" element={<Navigate to="/audio?format=ogg" replace />} />
                <Route path="/wav" element={<Navigate to="/audio?format=wav" replace />} />
                <Route path="/compare" element={<FileCompare />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Routes>
          </section>
        </main>
      </div>
    </div>
  )
}
