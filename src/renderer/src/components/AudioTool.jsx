/**
 * @file AudioTool.jsx
 * @description 音频压缩工具组件，支持取消、重试、日志筛选和压缩结果对比。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ComparePanel from './ComparePanel'
import CompareFullscreen from './CompareFullscreen'
import { useToast } from '../toast/useToast'
import {
  compressAudio,
  onAudioDone,
  onAudioPaused,
  onAudioProgress,
  onAudioTotal,
  openDirectory,
  openFiles,
  stopAudioCompression
} from '../api/desktop'
import { basename } from '../utils/fileUtils'

const STATUS_CLASS = {
  success: 'bg-green-100 text-emerald-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  paused: 'bg-orange-50 text-orange-600',
  cancelled: 'bg-stone-100 text-stone-500'
}

const FORMAT_META = {
  mixed: {
    label: '音频压缩',
    ext: '.mp3 / .ogg / .wav',
    filter: { name: 'Audio', extensions: ['mp3', 'ogg', 'wav'] },
    desc: '自动按文件扩展名选择压缩策略'
  },
  mp3: {
    label: 'MP3 压缩',
    ext: '.mp3',
    filter: { name: 'MP3 Audio', extensions: ['mp3'] },
    desc: '64kbps 单声道'
  },
  ogg: {
    label: 'OGG 压缩',
    ext: '.ogg',
    filter: { name: 'OGG Audio', extensions: ['ogg'] },
    desc: 'Vorbis 96kbps'
  },
  wav: {
    label: 'WAV 压缩',
    ext: '.wav',
    filter: { name: 'WAV Audio', extensions: ['wav'] },
    desc: '22.05kHz 重编码'
  }
}

const FORMAT_OPTIONS = [
  ['mixed', '混合'],
  ['mp3', 'MP3'],
  ['ogg', 'OGG'],
  ['wav', 'WAV']
]

function normalizeFormat(format) {
  return FORMAT_META[format] ? format : 'mixed'
}

function statusText(status) {
  if (status === 'success') return '✓ 压缩'
  if (status === 'skipped') return '— 跳过'
  if (status === 'paused') return '暂停'
  if (status === 'cancelled') return '取消'
  return '✗ 失败'
}

export default function AudioTool() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [format, setFormat] = useState(() => normalizeFormat(searchParams.get('format')))
  const meta = FORMAT_META[format]
  const [paths, setPaths] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const [paused, setPaused] = useState(null)
  const [activeTab, setActiveTab] = useState('log')
  const [compareFullscreen, setCompareFullscreen] = useState(false)
  const [logFilter, setLogFilter] = useState('all')
  const [recursive, setRecursive] = useState(true)
  const logRef = useRef(null)

  useEffect(() => {
    setFormat(normalizeFormat(searchParams.get('format')))
  }, [searchParams])

  const changeFormat = (nextFormat) => {
    setFormat(nextFormat)
    setSearchParams(nextFormat === 'mixed' ? {} : { format: nextFormat })
  }

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

  const addFiles = async () => {
    const files = await openFiles({ filters: [meta.filter] })
    if (files.length > 0) {
      setPaths((prev) => [...new Set([...prev, ...files])])
      toast.info(`已添加 ${files.length} 个音频文件`)
    }
  }

  const addDirectory = async () => {
    const dir = await openDirectory()
    if (dir) {
      setPaths((prev) => [...new Set([...prev, dir])])
      toast.info('已添加音频目录')
    }
  }

  const removePath = (path) => setPaths((prev) => prev.filter((item) => item !== path))

  const startCompress = async (filesToProcess, { isRetry = false } = {}) => {
    const targetFiles = filesToProcess ?? paths
    if (targetFiles.length === 0) {
      toast.warning('请先添加文件或目录')
      return
    }

    if (!filesToProcess) {
      setLogs([])
      setStats(null)
      setActiveTab('log')
    }
    setPaused(null)
    setTotal(0)
    setRunning(true)
    toast.info(isRetry ? `正在重试 ${targetFiles.length} 个失败项` : '开始压缩音频')

    const cleanTotal = onAudioTotal((count) => setTotal(count))
    const cleanProgress = onAudioProgress((item) => {
      if (isRetry) {
        setLogs((prev) => {
          const index = prev.findLastIndex((log) => log.file === item.file && log.status === 'error')
          if (index === -1) return [...prev, item]
          const next = [...prev]
          next[index] = item
          return next
        })
      } else {
        setLogs((prev) => [...prev, item])
      }
      scrollBottom()
    })
    const cleanup = () => {
      cleanTotal()
      cleanProgress()
      cleanDone()
      cleanPaused()
    }
    const cleanDone = onAudioDone((nextStats) => {
      setStats(nextStats)
      setRunning(false)
      toast.success(`音频压缩完成：成功 ${nextStats.processed}，失败 ${nextStats.failed}，跳过 ${nextStats.skipped}`)
      cleanup()
    })
    const cleanPaused = onAudioPaused(({ remaining }) => {
      setPaused({ remaining })
      setRunning(false)
      toast.warning(`任务已暂停，剩余 ${remaining.length} 个音频文件`)
      setLogs((prev) => [
        ...prev,
        {
          file: remaining[0] ?? `${meta.label}任务`,
          format,
          status: 'paused',
          error: `任务已暂停，剩余 ${remaining.length} 个文件`
        }
      ])
      cleanup()
    })

    try {
      await compressAudio({ paths: targetFiles, format, recursive })
    } catch (error) {
      setRunning(false)
      toast.error(`音频压缩失败：${error?.message ?? error}`)
      setLogs((prev) => [
        ...prev,
        {
          file: targetFiles[0] ?? `${meta.label}任务`,
          format,
          status: 'error',
          error: error?.message ?? String(error)
        }
      ])
      cleanup()
    }
  }

  const visibleLogs = logs.filter((item) => logFilter === 'all' || item.status === logFilter)
  const errorLogs = logs.filter((item) => item.status === 'error')
  const successCount = logs.filter((item) => item.status === 'success').length
  const skippedCount = logs.filter((item) => item.status === 'skipped').length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {compareFullscreen && <CompareFullscreen logs={logs} onClose={() => setCompareFullscreen(false)} />}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-7 py-6">
        <section className="shrink-0 rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-stone-800">{meta.label}</h3>
              <p className="mt-1 text-xs text-stone-500">{meta.desc}</p>
            </div>
            <div className="flex rounded-2xl border border-stone-200 p-1">
              {FORMAT_OPTIONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => changeFormat(id)}
                  disabled={running}
                  className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                    format === id ? 'tab-active' : 'interactive-ghost text-stone-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">目标路径</span>
            <div className="flex gap-2">
              <button
                onClick={addFiles}
                disabled={running}
                className="interactive-button rounded-2xl bg-sky-100 px-3 py-1.5 text-xs text-stone-950 disabled:opacity-50"
              >
                + 添加文件
              </button>
              <button
                onClick={addDirectory}
                disabled={running}
                className="interactive-button rounded-2xl bg-sky-100 px-3 py-1.5 text-xs text-stone-950 disabled:opacity-50"
              >
                + 添加目录
              </button>
            </div>
          </div>

          {paths.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 py-8 text-center text-sm text-stone-400">
              点击上方按钮添加 {meta.ext} 文件或目录
            </div>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {paths.map((path) => (
                <li key={path} className="flex items-center gap-2 text-sm">
                  <span className="text-xs text-stone-400">AUD</span>
                  <span className="flex-1 truncate font-mono text-xs text-stone-700" title={path}>
                    {path}
                  </span>
                  <button
                    onClick={() => removePath(path)}
                    disabled={running}
                    className="interactive-danger shrink-0 rounded-full px-1.5 text-xs text-stone-300 disabled:opacity-30"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-3 flex w-fit cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(event) => setRecursive(event.target.checked)}
              disabled={running}
              className="h-3.5 w-3.5 accent-[var(--theme-accent)] disabled:opacity-50"
            />
            <span className="text-xs text-stone-500">递归子目录</span>
          </label>
        </section>

        {paused ? (
          <>
            <section className="shrink-0 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              任务已暂停，还有 <span className="font-bold">{paused.remaining.length}</span> 个音频文件未处理。
            </section>
            <div className="flex shrink-0 gap-3">
              <button
                onClick={() => startCompress(paused.remaining)}
                className="interactive-button flex-1 rounded-2xl bg-sky-100 py-2.5 text-sm font-semibold text-stone-950"
              >
                继续压缩（{paused.remaining.length} 个）
              </button>
              <button
                onClick={() => {
                  setPaused(null)
                  toast.info('已放弃剩余音频任务')
                }}
                className="interactive-danger rounded-2xl border border-stone-200 px-4 py-2.5 text-sm text-stone-500"
              >
                放弃
              </button>
            </div>
          </>
        ) : running ? (
          <button
            onClick={() => {
              toast.info('正在暂停音频压缩')
              stopAudioCompression().catch((error) => toast.error(`暂停失败：${error?.message ?? error}`))
            }}
            className="w-full shrink-0 rounded-2xl bg-yellow-500 py-2.5 text-sm font-semibold text-white hover:bg-yellow-600"
          >
            暂停 ({logs.length}/{total})
          </button>
        ) : (
          <button
            onClick={() => startCompress()}
            className="interactive-button w-full shrink-0 rounded-2xl bg-sky-100 py-2.5 text-sm font-semibold text-stone-950"
          >
            开始压缩
          </button>
        )}

        {stats && (
          <section className="flex shrink-0 flex-wrap items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
            <span className="shrink-0 text-xs font-semibold text-emerald-900">压缩完成</span>
            <div className="flex flex-1 flex-wrap gap-4">
              {[
                ['总文件', stats.total, 'text-stone-700'],
                ['已压缩', stats.processed, 'text-emerald-700'],
                ['已跳过', stats.skipped, 'text-yellow-600'],
                ['失败', stats.failed, 'text-red-600']
              ].map(([label, value, color]) => (
                <span key={label} className="text-xs text-stone-500">
                  {label}：<span className={`font-bold ${color}`}>{value}</span>
                </span>
              ))}
            </div>
            <span className="shrink-0 text-xs text-emerald-700">
              节省 <span className="font-bold">{stats.savedBytes}</span>
            </span>
          </section>
        )}

        {logs.length > 0 && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/70 bg-white/72 shadow-sm shadow-stone-900/5">
            <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-4 py-2.5">
              <div className="flex gap-0.5">
                <button
                  onClick={() => setActiveTab('log')}
                  className={`rounded-2xl px-3 py-1.5 text-xs transition-colors ${
                    activeTab === 'log' ? 'tab-active font-medium' : 'interactive-ghost text-stone-400'
                  }`}
                >
                  处理日志
                </button>
                {stats && (
                  <button
                    onClick={() => setActiveTab('compare')}
                    className={`rounded-2xl px-3 py-1.5 text-xs transition-colors ${
                      activeTab === 'compare' ? 'tab-active font-medium' : 'interactive-ghost text-stone-400'
                    }`}
                  >
                    压缩对比
                    {successCount > 0 && (
                      <span className="compare-count-badge ml-1">
                        {successCount}
                      </span>
                    )}
                  </button>
                )}
                {successCount > 0 && (
                  <button
                    type="button"
                    title="全屏对比"
                    onClick={() => setCompareFullscreen(true)}
                    className="interactive-ghost compare-fullscreen-button rounded-2xl px-3 py-1.5 text-sm font-semibold text-stone-400"
                  >
                    ⛶
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                {activeTab === 'log' && (
                  <div className="flex gap-1">
                    {[
                      ['all', `全部 ${logs.length}`],
                      ['success', `成功 ${successCount}`],
                      ['skipped', `跳过 ${skippedCount}`],
                      ['error', `失败 ${errorLogs.length}`]
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setLogFilter(id)}
                        className={`rounded-2xl px-2 py-0.5 text-xs ${
                          logFilter === id ? 'tab-active font-medium' : 'interactive-ghost text-stone-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {activeTab === 'log' && !running && errorLogs.length > 0 && (
                  <button
                    onClick={() => startCompress(errorLogs.map((item) => item.file), { isRetry: true })}
                    className="interactive-danger rounded bg-red-50 px-2 py-0.5 text-xs text-red-500"
                  >
                    重试失败 ({errorLogs.length})
                  </button>
                )}
                {activeTab === 'log' && !running && logs.length > 0 && (
                  <button
                    onClick={() => {
                      setLogs([])
                      setStats(null)
                      toast.info('已清空音频处理日志')
                    }}
                    className="interactive-ghost rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500"
                  >
                    清空日志
                  </button>
                )}
                <span className="text-xs text-stone-400">
                  {visibleLogs.length} / {total || logs.length}
                </span>
              </div>
            </div>

            {activeTab === 'log' ? (
              <ul ref={logRef} className="flex-1 divide-y divide-stone-100 overflow-y-auto">
                {visibleLogs.map((item, index) => (
                  <li key={`${item.file}-${index}`} className="flex items-center gap-2 px-4 py-1.5">
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.status] ?? STATUS_CLASS.error}`}
                    >
                      {statusText(item.status)}
                    </span>
                    <span className="flex-1 truncate font-mono text-xs text-stone-600" title={item.file}>
                      {item.format ? `[${item.format.toUpperCase()}] ` : ''}
                      {basename(item.file)}
                    </span>
                    {item.status === 'success' && (
                      <span className="shrink-0 text-xs text-emerald-600">
                        {item.inputSize} → {item.outputSize}{' '}
                        <span className="text-emerald-500">(-{item.saved})</span>
                      </span>
                    )}
                    {item.status === 'skipped' && (
                      <span className="shrink-0 text-xs text-yellow-600">{item.reason}</span>
                    )}
                    {item.status === 'error' && (
                      <>
                        <span className="max-w-40 shrink-0 truncate text-xs text-red-500" title={item.error}>
                          {item.error}
                        </span>
                        <button
                          onClick={() => startCompress([item.file], { isRetry: true })}
                          disabled={running}
                          className="interactive-danger shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-400 disabled:opacity-30"
                        >
                          ↺
                        </button>
                      </>
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
