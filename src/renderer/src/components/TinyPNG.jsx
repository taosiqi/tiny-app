/**
 * @file TinyPNG.jsx
 * @description 图片压缩工具组件
 *
 * 功能：
 *  - 管理多个 TinyPNG API Key（支持增删与有效性验证）
 *  - 通过 IPC 调用主进程批量压缩 PNG/JPG/JPEG 图片
 *  - 实时展示每张图片的处理状态与压缩统计
 *  - API Key 列表持久化至 Rust 端设置文件
 */
import { useState, useRef, useCallback } from 'react'
import ComparePanel from './ComparePanel'
import CompareFullscreen from './CompareFullscreen'
import { TinypngKeyManagerView } from './TinypngKeyManager'
import { useToast } from '../toast/useToast'
import {
  compressImage,
  onImageDone,
  onImageKeyCount,
  onImagePaused,
  onImageProgress,
  onImageTotal,
  openDirectories,
  openFiles,
  stopImageCompression
} from '../api/desktop'
import { KEY_LIMIT, useTinypngKeys } from '../tinypng/useTinypngKeys'
import { basename } from '../utils/fileUtils'
import { useSettings } from '../settings/useSettings'
import { getPreset } from '../tasks/taskPresets'
import { createTaskRecord, finishTaskRecord, upsertTaskRecord } from '../tasks/taskHistory'

/** 日志条目状态 → Tailwind 色彩类映射 */
const STATUS_CLASS = {
  success: 'bg-green-100 text-emerald-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  paused: 'bg-orange-50 text-orange-600',
  cancelled: 'bg-stone-100 text-stone-500',
  pending: 'bg-stone-100 text-stone-500'
}

/**
 * TinyPNG 图片压缩组件
 *
 * @component
 */
export default function TinyPNG() {
  const toast = useToast()
  const { settings } = useSettings()
  const defaultPreset = getPreset(settings)
  const keyController = useTinypngKeys({ autoValidate: true, toast })
  const { keys, setKeys, validKeyValues } = keyController
  const [paths, setPaths] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  // paused: null | { remaining: string[] }  —— Key 耗尽暂停时保存未处理文件列表
  const [paused, setPaused] = useState(null)
  const [activeTab, setActiveTab] = useState('log')
  const [compareFullscreen, setCompareFullscreen] = useState(false)
  const [logFilter, setLogFilter] = useState('all')
  const [recursive, setRecursive] = useState(defaultPreset.recursiveScan)
  const taskRecordRef = useRef(null)
  const logRef = useRef(null)

  /** 将日志容器滚动到底部（延迟 50ms 等待 DOM 更新） */
  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

  const addFiles = async () => {
    const files = await openFiles({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    })
    if (files.length > 0) {
      setPaths((prev) => [...new Set([...prev, ...files])])
      toast.info(`已添加 ${files.length} 个图片文件`)
    }
  }

  const addDirectory = async () => {
    const dirs = await openDirectories()
    if (dirs.length > 0) {
      setPaths((prev) => [...new Set([...prev, ...dirs])])
      toast.info(`已添加 ${dirs.length} 个图片目录`)
    }
  }

  const removePath = (p) => setPaths((prev) => prev.filter((x) => x !== p))

  /**
   * 开始批量压缩
   *
   * @param {string[]} [filesToProcess] 传入时为"继续压缩"场景，使用指定文件列表；
   *                                    不传时为全新压缩，使用 paths 状态。
   * @param {object}  [opts]
   * @param {boolean} [opts.isRetry=false] 为 true 时，进度结果替换日志中同路径的旧条目而非追加
   */
  const startCompress = async (filesToProcess, { isRetry = false } = {}) => {
    const targetFiles = filesToProcess ?? paths
    const validKeys = validKeyValues
    if (validKeys.length === 0) {
      toast.warning('请先填写 TinyPNG API Key')
      return
    }
    if (targetFiles.length === 0) {
      toast.warning('请先添加文件或目录')
      return
    }

    // 全新开始时清空日志；继续/重试时保留已有日志
    if (!filesToProcess) {
      setLogs([])
      setStats(null)
      setActiveTab('log')
    }
    setPaused(null)
    setTotal(0)
    setRunning(true)
    const taskRecord = createTaskRecord({
      source: 'image',
      presetId: defaultPreset.id,
      presetSnapshot: { ...defaultPreset, recursiveScan: recursive },
      inputCount: targetFiles.length
    })
    taskRecordRef.current = taskRecord
    upsertTaskRecord(taskRecord)
    toast.info(isRetry ? `正在重试 ${targetFiles.length} 个失败项` : '开始压缩图片')

    const cleanTotal = onImageTotal((n) => {
      setTotal(n)
    })
    const cleanProgress = onImageProgress((item) => {
      if (isRetry) {
        // 重试：替换同路径的最后一条错误条目；若找不到则追加
        setLogs((prev) => {
          const idx = prev.findLastIndex((l) => l.file === item.file && l.status === 'error')
          if (idx === -1) return [...prev, item]
          const next = [...prev]
          next[idx] = item
          return next
        })
      } else {
        setLogs((prev) => [...prev, item])
      }
      scrollBottom()
      const record = taskRecordRef.current
      if (record) {
        const next = { ...record, logs: [...record.logs, item] }
        taskRecordRef.current = next
        upsertTaskRecord(next)
      }
    })
    const cleanKeyCount = onImageKeyCount(({ key, compressionCount }) => {
      setKeys((prev) =>
        prev.map((k) =>
          k.value.trim() === key
            ? {
                ...k,
                status: 'valid',
                compressionCount,
                error: compressionCount >= KEY_LIMIT ? '当月已达上限' : null
              }
            : k
        )
      )
    })
    const cleanup = () => {
      cleanTotal()
      cleanProgress()
      cleanKeyCount()
      cleanDone()
      cleanPaused()
    }
    const cleanDone = onImageDone((s) => {
      setStats(s)
      setRunning(false)
      toast.success(`图片压缩完成：成功 ${s.processed}，失败 ${s.failed}，跳过 ${s.skipped}`)
      if (taskRecordRef.current) upsertTaskRecord(finishTaskRecord(taskRecordRef.current, s.failed > 0 ? 'error' : 'success', s, taskRecordRef.current.logs))
      // 任务完成后清理所有 IPC 监听器，防止泄漏
      cleanup()
    })
    const cleanPaused = onImagePaused(({ remaining }) => {
      // Key 全部耗尽：暂停任务，保存剩余文件列表，等待用户添加新 Key 后继续
      setPaused({ remaining })
      setRunning(false)
      toast.warning(`任务已暂停，剩余 ${remaining.length} 张图片未处理`)
      if (taskRecordRef.current) upsertTaskRecord(finishTaskRecord(taskRecordRef.current, 'paused', taskRecordRef.current.stats, taskRecordRef.current.logs))
      cleanup()
    })

    try {
      await compressImage({ paths: targetFiles, apiKeys: validKeys, recursive })
    } catch (error) {
      setRunning(false)
      toast.error(`图片压缩失败：${error?.message ?? error}`)
      setLogs((prev) => [
        ...prev,
        {
          file: targetFiles[0] ?? '图片压缩任务',
          status: 'error',
          error: error?.message ?? String(error)
        }
      ])
      if (taskRecordRef.current) {
        const nextLogs = [...taskRecordRef.current.logs, { file: targetFiles[0] ?? '图片压缩任务', status: 'error', error: error?.message ?? String(error) }]
        upsertTaskRecord(finishTaskRecord(taskRecordRef.current, 'error', taskRecordRef.current.stats, nextLogs))
      }
      cleanup()
    }
  }

  const visibleLogs = logs.filter((item) => logFilter === 'all' || item.status === logFilter)
  const errorLogs = logs.filter((item) => item.status === 'error')
  const successCount = logs.filter((item) => item.status === 'success').length
  const skippedCount = logs.filter((item) => item.status === 'skipped').length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {compareFullscreen && (
        <CompareFullscreen logs={logs} onClose={() => setCompareFullscreen(false)} />
      )}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-7 py-6 gap-4">
        {/* API Keys */}
        <section className="shrink-0 rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
          <TinypngKeyManagerView controller={keyController} disabled={running} />
        </section>

        {/* Paths */}
        <section className="bg-white/72 rounded-3xl border border-white/70 shadow-sm shadow-stone-900/5 p-5 shrink-0">
          <div className="flex items-center justify-between mb-3">
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
            <div className="text-center py-8 text-stone-400 text-sm border border-dashed border-stone-200 rounded-2xl">
              点击上方按钮添加图片文件或目录
            </div>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {paths.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm">
                  <span className="text-stone-400 text-xs">📄</span>
                  <span className="flex-1 truncate text-stone-700 font-mono text-xs" title={p}>
                    {p}
                  </span>
                  <button
                    onClick={() => removePath(p)}
                    disabled={running}
                    className="interactive-danger shrink-0 rounded-full px-1.5 text-xs text-stone-300 disabled:opacity-30"
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
              className="w-3.5 h-3.5 accent-[var(--theme-accent)] disabled:opacity-50"
            />
            <span className="text-xs text-stone-500">递归子目录</span>
          </label>
        </section>

        {/* Start button / Paused state */}
        {paused ? (
          <>
            {/* 暂停提示 */}
            <section className="bg-orange-50 border border-orange-200 rounded-2xl px-4 py-3 text-sm text-orange-800 shrink-0">
              {keys
                .filter((k) => k.status === 'valid')
                .every((k) => k.compressionCount >= KEY_LIMIT) ? (
                <>
                  ⚠️ 所有 API Key 已达当月上限，还有{' '}
                  <span className="font-bold">{paused.remaining.length}</span> 张图片未处理。
                  请在上方添加新 Key 后点击继续。
                </>
              ) : (
                <>
                  ⏸ 任务已暂停，还有 <span className="font-bold">{paused.remaining.length}</span>{' '}
                  张图片未处理。
                </>
              )}
            </section>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={() => startCompress(paused.remaining)}
                className="interactive-button flex-1 rounded-2xl bg-sky-100 py-2.5 text-sm font-semibold text-stone-950"
              >
                ▶ 继续压缩（{paused.remaining.length} 张）
              </button>
              <button
                onClick={() => {
                  setPaused(null)
                  toast.info('已放弃剩余图片任务')
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
              toast.info('正在暂停图片压缩')
              stopImageCompression().catch((error) =>
                toast.error(`暂停失败：${error?.message ?? error}`)
              )
            }}
            className="w-full shrink-0 rounded-2xl bg-yellow-500 py-2.5 text-sm font-semibold text-white hover:bg-yellow-600"
          >
            ⏸ 暂停 ({logs.length}/{total})
          </button>
        ) : (
          <button
            onClick={() => startCompress()}
            disabled={running}
            className="interactive-button w-full shrink-0 rounded-2xl bg-sky-100 py-2.5 text-sm font-semibold text-stone-950"
          >
            🚀 开始压缩
          </button>
        )}

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
                  className={`rounded-2xl px-3 py-1.5 text-xs ${
                    activeTab === 'log'
                      ? 'tab-active font-medium'
                      : 'interactive-ghost text-stone-400'
                  }`}
                >
                  处理日志
                </button>
                {stats && (
                  <button
                    onClick={() => setActiveTab('compare')}
                    className={`rounded-2xl px-3 py-1.5 text-xs ${
                      activeTab === 'compare'
                        ? 'tab-active font-medium'
                        : 'interactive-ghost text-stone-400'
                    }`}
                  >
                    压缩对比
                    {logs.filter((l) => l.status === 'success').length > 0 && (
                      <span className="compare-count-badge ml-1">
                        {logs.filter((l) => l.status === 'success').length}
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
                          logFilter === id
                            ? 'tab-active font-medium'
                            : 'interactive-ghost text-stone-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {activeTab === 'log' && !running && errorLogs.length > 0 && (
                  <button
                    onClick={() =>
                      startCompress(
                        errorLogs.map((l) => l.file),
                        { isRetry: true }
                      )
                    }
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
                      toast.info('已清空图片处理日志')
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
              <ul ref={logRef} className="flex-1 overflow-y-auto divide-y divide-stone-100">
                {visibleLogs.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 px-4 py-1.5">
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASS[item.status] || STATUS_CLASS.pending}`}
                    >
                      {item.status === 'success'
                        ? '✓ 压缩'
                        : item.status === 'skipped'
                          ? '— 跳过'
                          : item.status === 'paused'
                            ? '暂停'
                            : item.status === 'cancelled'
                              ? '取消'
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
                      <>
                        <span
                          className="text-xs text-red-500 shrink-0 max-w-32 truncate"
                          title={item.error}
                        >
                          {item.error}
                        </span>
                        <button
                          onClick={() => startCompress([item.file], { isRetry: true })}
                          disabled={running}
                          className="interactive-danger shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-400 disabled:opacity-30"
                          title="重试"
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
