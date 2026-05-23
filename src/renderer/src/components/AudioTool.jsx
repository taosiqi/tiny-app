/**
 * @file AudioTool.jsx
 * @description 音频压缩工具组件
 *
 * 支持 MP3 和 OGG 两种格式，通过 `format` prop 区分。
 * 内部通过 IPC 调用主进程的 ffmpeg 完成实际压缩，
 * 并以日志列表形式实时展示每个文件的处理结果。
 */
import { useState, useRef, useCallback } from 'react'
import PropTypes from 'prop-types'
import ComparePanel from './ComparePanel'
import { compressAudio, onAudioDone, onAudioProgress, onAudioTotal, openDirectory, openFiles } from '../api/desktop'
import { basename } from '../utils/fileUtils'

/** 日志条目状态 → Tailwind 色彩类映射 */
const STATUS_CLASS = {
  success: 'bg-green-100 text-emerald-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700'
}

/** 各音频格式的 UI 元数据与文件过滤配置 */
const FORMAT_META = {
  mp3: {
    label: 'MP3 压缩',
    ext: '.mp3',
    filter: { name: 'MP3 Audio', extensions: ['mp3'] }
  },
  ogg: {
    label: 'OGG 压缩',
    ext: '.ogg',
    filter: { name: 'OGG Audio', extensions: ['ogg'] }
  },
  wav: {
    label: 'WAV 压缩',
    ext: '.wav',
    filter: { name: 'WAV Audio', extensions: ['wav'] }
  }
}

/**
 * 音频压缩组件
 *
 * @component
 * @param {'mp3'|'ogg'} format - 目标音频格式
 */
export default function AudioTool({ format }) {
  const meta = FORMAT_META[format]
  const [paths, setPaths] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const [activeTab, setActiveTab] = useState('log')
  const [recursive, setRecursive] = useState(true)
  const logRef = useRef(null)

  /** 将日志容器滚动到底部（延迟 50ms 等待 DOM 更新） */
  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

  const addFiles = async () => {
    const files = await openFiles({ filters: [meta.filter] })
    if (files.length > 0) setPaths((prev) => [...new Set([...prev, ...files])])
  }

  const addDirectory = async () => {
    const dir = await openDirectory()
    if (dir) setPaths((prev) => [...new Set([...prev, dir])])
  }

  const removePath = (p) => setPaths((prev) => prev.filter((x) => x !== p))

  /**
   * 开始批量压缩
   *
   * 注册全部 IPC 事件监听器后触发压缩任务，任务完成时清理所有监听器。
   */
  const startCompress = () => {
    if (paths.length === 0) return alert('请先添加文件或目录')

    setLogs([])
    setStats(null)
    setActiveTab('log')
    setTotal(0)
    setRunning(true)

    const cleanTotal = onAudioTotal((n) => setTotal(n))
    const cleanProgress = onAudioProgress((item) => {
      setLogs((prev) => [...prev, item])
      scrollBottom()
    })
    const cleanDone = onAudioDone((s) => {
      setStats(s)
      setRunning(false)
      // 任务完成后清理所有 IPC 监听器，防止泄漏
      cleanTotal()
      cleanProgress()
      cleanDone()
    })

    compressAudio({ paths, format, recursive })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-7 py-6 gap-4">
        {/* Paths */}
        <section className="bg-white/72 rounded-3xl border border-white/70 shadow-sm shadow-stone-900/5 p-5 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-stone-700">目标路径</span>
            <div className="flex gap-2">
              <button
                onClick={addFiles}
                disabled={running}
                className="text-xs px-3 py-1.5 bg-lime-100 text-stone-950 rounded-2xl hover:bg-lime-200 disabled:opacity-50 transition-colors"
              >
                + 添加文件
              </button>
              <button
                onClick={addDirectory}
                disabled={running}
                className="text-xs px-3 py-1.5 bg-lime-100 text-stone-950 rounded-2xl hover:bg-lime-200 disabled:opacity-50 transition-colors"
              >
                + 添加目录
              </button>
            </div>
          </div>

          {paths.length === 0 ? (
            <div className="text-center py-8 text-stone-400 text-sm border border-dashed border-stone-200 rounded-2xl">
              点击上方按钮添加 {meta.ext} 文件或目录
            </div>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {paths.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm">
                  <span className="text-stone-400 text-xs">🎧</span>
                  <span className="flex-1 truncate text-stone-700 font-mono text-xs" title={p}>
                    {p}
                  </span>
                  <button
                    onClick={() => removePath(p)}
                    disabled={running}
                    className="text-stone-300 hover:text-red-400 text-xs shrink-0 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-3 flex items-center gap-2 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
              disabled={running}
              className="w-3.5 h-3.5 accent-lime-500 disabled:opacity-50"
            />
            <span className="text-xs text-stone-500">递归子目录</span>
          </label>
        </section>

        {/* Start button */}
        <button
          onClick={startCompress}
          disabled={running}
          className={`w-full shrink-0 py-2.5 rounded-2xl text-sm font-semibold transition-colors
            ${
              running
                ? 'bg-stone-300 text-white cursor-not-allowed'
                : 'bg-stone-950 text-white hover:bg-stone-800'
            }`}
        >
          {running ? `⏳ 压缩中… (${logs.length}/${total})` : '🚀 开始压缩'}
        </button>

        {/* Stats — 紧凑横条，位于日志区上方 */}
        {stats && (
          <section className="shrink-0 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="text-xs font-semibold text-emerald-900 shrink-0">✅ 压缩完成</span>
            <div className="flex gap-4 flex-1 flex-wrap">
              {[
                { label: '总文件', value: stats.total, color: 'text-stone-700' },
                { label: '已压缩', value: stats.processed, color: 'text-emerald-700' },
                { label: '已跳过', value: stats.skipped, color: 'text-yellow-600' },
                { label: '失败', value: stats.failed, color: 'text-red-600' }
              ].map(({ label, value, color }) => (
                <span key={label} className="text-xs text-stone-500">
                  {label}：<span className={`font-bold ${color}`}>{value}</span>
                </span>
              ))}
            </div>
            <span className="text-xs text-emerald-700 shrink-0">
              节省 <span className="font-bold">{stats.savedBytes}</span>
            </span>
          </section>
        )}

        {/* Log / Compare tabs */}
        {logs.length > 0 && (
          <section className="bg-white/72 rounded-3xl border border-white/70 shadow-sm shadow-stone-900/5 flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-stone-100 flex items-center justify-between shrink-0">
              <div className="flex gap-0.5">
                <button
                  onClick={() => setActiveTab('log')}
                  className={`text-xs px-3 py-1.5 rounded-2xl transition-colors ${
                    activeTab === 'log'
                      ? 'bg-stone-100 text-stone-700 font-medium'
                      : 'text-stone-400 hover:text-stone-600'
                  }`}
                >
                  处理日志
                </button>
                {stats && (
                  <button
                    onClick={() => setActiveTab('compare')}
                    className={`text-xs px-3 py-1.5 rounded-2xl transition-colors ${
                      activeTab === 'compare'
                        ? 'bg-lime-100 text-stone-950 font-medium'
                        : 'text-stone-400 hover:text-emerald-700'
                    }`}
                  >
                    压缩对比
                    {logs.filter((l) => l.status === 'success').length > 0 && (
                      <span className="ml-1 bg-lime-100 text-stone-950 rounded-full px-1.5 py-0.5 text-[10px]">
                        {logs.filter((l) => l.status === 'success').length}
                      </span>
                    )}
                  </button>
                )}
              </div>
              <span className="text-xs text-stone-400">
                {logs.length} / {total}
              </span>
            </div>
            {activeTab === 'log' ? (
              <ul ref={logRef} className="flex-1 overflow-y-auto divide-y divide-stone-100">
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
                      className="flex-1 truncate text-xs text-stone-600 font-mono"
                      title={item.file}
                    >
                      {basename(item.file)}
                    </span>
                    {item.status === 'success' && (
                      <span className="text-xs text-emerald-600 shrink-0">
                        {item.inputSize} → {item.outputSize}{' '}
                        <span className="text-emerald-500">(-{item.saved})</span>
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
            ) : (
              <div className="flex-1 overflow-y-auto p-4">
                <ComparePanel logs={logs} />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

AudioTool.propTypes = { format: PropTypes.oneOf(['mp3', 'ogg', 'wav']).isRequired }
