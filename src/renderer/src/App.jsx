import { useState } from 'react'
import TinyPNG from './components/TinyPNG'
import AudioTool from './components/AudioTool'

const TABS = [
  { id: 'png', label: '图片压缩', icon: '🖼', desc: 'PNG / JPG / JPEG' },
  { id: 'mp3', label: 'MP3 压缩', icon: '🎵', desc: '.mp3' },
  { id: 'ogg', label: 'OGG 压缩', icon: '🎶', desc: '.ogg' }
]

function App() {
  const [active, setActive] = useState('png')

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 text-gray-800 select-none">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col bg-slate-900 text-slate-100 shrink-0">
        <div className="px-5 py-5 border-b border-slate-700">
          <h1 className="text-xl font-bold tracking-wide text-white">Tiny App</h1>
          <p className="text-xs text-slate-400 mt-0.5">资源压缩工具集</p>
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

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {active === 'png' && <TinyPNG />}
        {active === 'mp3' && <AudioTool key="mp3" format="mp3" />}
        {active === 'ogg' && <AudioTool key="ogg" format="ogg" />}
      </main>
    </div>
  )
}

export default App
