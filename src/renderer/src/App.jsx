/**
 * @file App.jsx
 * @description 应用根组件
 *
 * 维护当前激活的工具页签（active），通过侧边栏导航在
 * 图片压缩（TinyPNG）和音频压缩（AudioTool）之间切换。
 */
import { useState } from 'react'
import TinyPNG from './components/TinyPNG'
import AudioTool from './components/AudioTool'

/** 侧边栏导航配置，每项对应一个工具页签 */
const TABS = [
  { id: 'png', label: '图片压缩', icon: '', desc: 'PNG / JPG / JPEG' },
  { id: 'mp3', label: 'MP3 压缩', icon: '', desc: '.mp3' },
  { id: 'ogg', label: 'OGG 压缩', icon: '', desc: '.ogg' }
]

/**
 * App 根组件
 *
 * 渲染两栏布局：左侧固定侧边栏（导航）+ 右侧内容区（工具组件）。
 * `active` 状态决定当前展示哪个工具；AudioTool 使用 `key` prop
 * 确保切换 mp3/ogg 时重置组件内部状态。
 */
function App() {
  const [active, setActive] = useState('png')

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 text-gray-800 select-none">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col bg-slate-900 text-slate-100 shrink-0">
        <div className="px-5 py-5 border-b border-slate-700">
          <h1 className="text-xl font-bold tracking-wide text-white">Tiny App</h1>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-150
                ${
                  active === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <div>
                <div className="text-sm font-medium leading-none mb-0.5">{tab.label}</div>
                <div className="text-xs opacity-60">{tab.desc}</div>
              </div>
            </button>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-slate-700 text-xs text-slate-500">v1.0.0</div>
      </aside>

      {/* Content：全部常驻，CSS 控制显隐，避免切换时销毁组件状态 */}
      <main className="flex-1 overflow-hidden">
        <div className={active === 'png' ? 'h-full' : 'hidden'}>
          <TinyPNG />
        </div>
        <div className={active === 'mp3' ? 'h-full' : 'hidden'}>
          <AudioTool format="mp3" />
        </div>
        <div className={active === 'ogg' ? 'h-full' : 'hidden'}>
          <AudioTool format="ogg" />
        </div>
      </main>
    </div>
  )
}

export default App
