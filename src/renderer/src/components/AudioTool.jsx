import { useState, useRef, useCallback } from 'react'

const STATUS_CLASS = {
  success: 'bg-green-100 text-green-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700'
}

const FORMAT_META = {
  mp3: {
    icon: '🎵',
    label: 'MP3 压缩',
    desc: '使用 ffmpeg 将 MP3 压缩为 64kbps 单声道 44.1kHz',
    ext: '.mp3',
    filter: { name: 'MP3 Audio', extensions: ['mp3'] }
  },
  ogg: {
    icon: '🎶',
    label: 'OGG 压缩',
    desc: '使用 ffmpeg 将 OGG 压缩为 libvorbis 96kbps 44.1kHz',
    ext: '.ogg',
    filter: { name: 'OGG Audio', extensions: ['ogg'] }
  }
}

function basename(p) {
  return p.replace(/\\/g, '/').split('/').pop()
}

export default function AudioTool({ format }) {
  const meta = FORMAT_META[format]
  const [paths, setPaths] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const logRef = useRef(null)

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

  const addFiles = async () => {
    const files = await window.api.openFiles({ filters: [meta.filter] })
    if (files.length > 0) setPaths((prev) => [...new Set([...prev, ...files])])
  }

  const addDirectory = async () => {
    const dir = await window.api.openDirectory()
    if (dir) setPaths((prev) => [...new Set([...prev, dir])])
  }

  const removePath = (p) => setPaths((prev) => prev.filter((x) => x !== p))

  const startCompress = () => {
    if (paths.length === 0) return alert('请先添加文件或目录')

    setLogs([])
    setStats(null)
    setTotal(0)
    setRunning(true)

    const cleanTotal = window.api.onAudioTotal((n) => setTotal(n))
    const cleanProgress = window.api.onAudioProgress((item) => {
      setLogs((prev) => [...prev, item])
      scrollBottom()
    })
    const cleanDone = window.api.onAudioDone((s) => {
      setStats(s)
      setRunning(false)
      cleanTotal()
      cleanProgress()
      cleanDone()
    })

    window.api.compressAudio({ paths, format })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span>{meta.icon}</span> {meta.label}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">{meta.desc}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Paths */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">目标路径</span>
            <div className="flex gap-2">
              <button
                onClick={addFiles}
                disabled={running}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                + 添加文件
              </button>
              <button
                onClick={addDirectory}
                disabled={running}
                className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
              >
                + 添加目录
              </button>
            </div>
          </div>

          {paths.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
              点击上方按钮添加 {meta.ext} 文件或目录
            </div>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {paths.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 text-xs">🎧</span>
                  <span className="flex-1 truncate text-gray-700 font-mono text-xs" title={p}>
                    {p}
                  </span>
                  <button
                    onClick={() => removePath(p)}
                    disabled={running}
                    className="text-gray-300 hover:text-red-400 text-xs shrink-0 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Start button */}
        <button
          onClick={startCompress}
          disabled={running}
          className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors
            ${
              running
                ? 'bg-blue-300 text-white cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
        >
          {running ? `⏳ 压缩中… (${logs.length}/${total})` : '🚀 开始压缩'}
        </button>

        {/* Log */}
        {logs.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600">处理日志</span>
              <span className="text-xs text-gray-400">
                {logs.length} / {total}
              </span>
            </div>
            <ul ref={logRef} className="max-h-52 overflow-y-auto divide-y divide-gray-50">
              {logs.map((item, i) => (
                <li key={i} className="flex items-center gap-2 px-4 py-1.5">
                  <span
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASS[item.status]}`}
                  >
                    {item.status === 'success'
                      ? '✓ 压缩'
                      : item.status === 'skipped'
                        ? '— 跳过'
                        : '✗ 失败'}
                  </span>
                  <span
                    className="flex-1 truncate text-xs text-gray-600 font-mono"
                    title={item.file}
                  >
                    {basename(item.file)}
                  </span>
                  {item.status === 'success' && (
                    <span className="text-xs text-green-600 shrink-0">
                      {item.inputSize} → {item.outputSize}{' '}
                      <span className="text-green-500">(-{item.saved})</span>
                    </span>
                  )}
                  {item.status === 'skipped' && (
                    <span className="text-xs text-yellow-600 shrink-0">{item.reason}</span>
                  )}
                  {item.status === 'error' && (
                    <span
                      className="text-xs text-red-500 shrink-0 max-w-40 truncate"
                      title={item.error}
                    >
                      {item.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Stats */}
        {stats && (
          <section className="bg-green-50 border border-green-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-green-800 mb-3">✅ 压缩完成</h3>
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: '总文件', value: stats.total, color: 'text-gray-700' },
                { label: '已压缩', value: stats.processed, color: 'text-green-700' },
                { label: '已跳过', value: stats.skipped, color: 'text-yellow-700' },
                { label: '失败', value: stats.failed, color: 'text-red-700' }
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="bg-white rounded-lg p-3 text-center border border-green-100"
                >
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center text-sm text-green-700">
              共节省空间：<span className="font-bold">{stats.savedBytes}</span>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
