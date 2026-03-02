/**
 * @file App.jsx
 * @description 应用根组件
 *
 * 使用 React Router（HashRouter）+ keepalive-for-react 实现
 * 带 keep-alive 的路由切换，组件状态在页签间切换时不会丢失。
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

/** 侧边栏导航配置，path 对应路由路径 */
const TABS = [
  { path: '/png', label: '图片压缩', icon: '', desc: 'PNG / JPG / JPEG' },
  { path: '/mp3', label: 'MP3 压缩', icon: '', desc: '.mp3' },
  { path: '/ogg', label: 'OGG 压缩', icon: '', desc: '.ogg' }
]

/**
 * KeepAliveLayout
 *
 * 读取当前路由作为 activeCacheKey，将 outlet 组件包裹在 KeepAlive 中，
 * 实现切换路由时组件状态保活。
 */
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

/**
 * App 根组件
 *
 * 渲染两栏布局：左侧固定侧边栏（NavLink 导航）+ 右侧内容区（KeepAliveLayout）。
 */
function App() {
  const [appVersion, setAppVersion] = useState('...')

  useEffect(() => {
    let active = true
    window.api
      .getAppVersion()
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
    <HashRouter>
      <div className="flex h-screen w-screen overflow-hidden bg-gray-50 text-gray-800 select-none">
        {/* Sidebar */}
        <aside className="w-52 flex flex-col bg-slate-900 text-slate-100 shrink-0">
          <div className="px-5 py-5 border-b border-slate-700">
            <h1 className="text-xl font-bold tracking-wide text-white">无损压缩</h1>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1">
            {TABS.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-150 ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`
                }
              >
                <span className="text-lg leading-none">{tab.icon}</span>
                <div>
                  <div className="text-sm font-medium leading-none mb-0.5">{tab.label}</div>
                  <div className="text-xs opacity-60">{tab.desc}</div>
                </div>
              </NavLink>
            ))}
          </nav>

          <div className="px-5 py-4 border-t border-slate-700 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span className="tracking-wide">版本</span>
              <span className="text-slate-200 font-medium tabular-nums">v{appVersion}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-slate-400">
              <span className="tracking-wide">作者</span>
              <span className="text-slate-300 font-medium select-text">Slack / taosiqi</span>
            </div>
          </div>
        </aside>

        {/* Content：KeepAlive 保活，切换路由不销毁组件状态 */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/png" replace />} />
            <Route element={<KeepAliveLayout />}>
              <Route path="/png" element={<TinyPNG />} />
              <Route path="/mp3" element={<AudioTool format="mp3" />} />
              <Route path="/ogg" element={<AudioTool format="ogg" />} />
            </Route>
          </Routes>
        </main>
      </div>
    </HashRouter>
  )
}

export default App
