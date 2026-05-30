import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { getAppVersion, onOpenSettings } from '../api/desktop'
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
    <div className="app-shell h-screen w-screen overflow-auto text-stone-900 select-none md:overflow-hidden">
      <div className="absolute inset-0 app-ambient" />
      <div className="relative z-10 flex min-h-full flex-col gap-5 p-5 md:h-full md:flex-row">
        <Sidebar appVersion={appVersion} />

        <main className="flex min-h-[720px] min-w-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/60 bg-white/62 shadow-[0_24px_80px_rgba(30,41,59,0.12)] backdrop-blur-2xl md:min-h-0">
          <section className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  )
}
