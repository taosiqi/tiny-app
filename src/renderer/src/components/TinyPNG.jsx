/**
 * @file TinyPNG.jsx
 * @description 图片压缩工具组件
 *
 * 功能：
 *  - 管理多个 TinyPNG API Key（支持增删与有效性验证）
 *  - 通过 IPC 调用主进程批量压缩 PNG/JPG/JPEG 图片
 *  - 实时展示每张图片的处理状态与压缩统计
 *  - API Key 列表持久化至 localStorage
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import PropTypes from 'prop-types'
import ComparePanel from './ComparePanel'
import { checkTinypngKey, compressImage, onImageDone, onImageKeyCount, onImagePaused, onImageProgress, onImageTotal, openDirectory, openExternal, openFiles, stopImageCompression } from '../api/desktop'
import { basename } from '../utils/fileUtils'

/**
 * Tooltip 组件：通过 Portal 渲染到 body，彻底脱离 overflow-hidden 的裁剪
 */
Tooltip.propTypes = { text: PropTypes.node }
function Tooltip({ text }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)

  const show = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({
        top: rect.top - 8,
        left: rect.left + rect.width / 2
      })
    }
    setVisible(true)
  }

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={() => setVisible(false)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-stone-100 text-stone-400 text-[10px] font-bold cursor-default hover:bg-lime-200 hover:text-emerald-700 transition-colors"
      >
        i
      </span>
      {visible &&
        createPortal(
          <div
            className="fixed z-99999 pointer-events-none"
            style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
          >
            <div className="w-64 px-3 py-2 rounded-2xl bg-stone-900 text-white text-[11px] leading-relaxed shadow-lg">
              {text}
              <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-stone-900" />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** localStorage 中存储 API Key 列表的键名 */
const STORAGE_KEY = 'tinypng_keys'

/**
 * 从 localStorage 加载已保存的 API Key 列表
 *
 * 恢复时将运行时状态（status / error）重置为初始值，
 * 避免上次会话的校验结果影响当前会话的 UI 展示。
 *
 * @returns {Array|null} Key 对象数组，若无合法数据则返回 null
 */
function loadStoredKeys() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      // 恢复时把运行时状态重置为 idle，避免持久化的旧状态干扰 UI
      return parsed.map((k) => ({ ...k, status: 'idle', error: null }))
    }
  } catch (e) {
    void e
  }
  return null
}

/** 日志条目状态 → Tailwind 色彩类映射 */
const STATUS_CLASS = {
  success: 'bg-green-100 text-emerald-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  pending: 'bg-stone-100 text-stone-500'
}

/** TinyPNG 每个 API Key 每月免费压缩次数上限 */
const KEY_LIMIT = 500

/**
 * TinyPNG 图片压缩组件
 *
 * @component
 */
export default function TinyPNG() {
  const [keys, setKeys] = useState(
    () => loadStoredKeys() ?? [{ value: '', status: 'idle', compressionCount: null, error: null }]
  )
  const [paths, setPaths] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  // paused: null | { remaining: string[] }  —— Key 耗尽暂停时保存未处理文件列表
  const [paused, setPaused] = useState(null)
  const [activeTab, setActiveTab] = useState('log')
  const [recursive, setRecursive] = useState(true)
  const logRef = useRef(null)

  /** 将日志容器滚动到底部（延迟 50ms 等待 DOM 更新） */
  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

  // keys 变化时持久化（只存 value 和 compressionCount，运行时状态不持久化）
  useEffect(() => {
    const toStore = keys.map(({ value, compressionCount }) => ({ value, compressionCount }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  }, [keys])

  /** 更新指定索引的 Key 对象（局部合并更新） */
  const updateKey = (i, patch) =>
    setKeys((prev) => prev.map((k, idx) => (idx === i ? { ...k, ...patch } : k)))

  /** 在末尾追加一个空白 Key 输入项 */
  const addKey = () =>
    setKeys((prev) => [...prev, { value: '', status: 'idle', compressionCount: null, error: null }])

  /** 删除指定索引的 Key */
  const removeKey = (i) => setKeys((prev) => prev.filter((_, idx) => idx !== i))

  /**
   * 校验指定索引的 API Key 有效性
   * 校验期间将状态置为 'checking'，校验完成后更新为 'valid' 或 'invalid'
   */
  const checkKey = async (i) => {
    const keyVal = keys[i].value.trim()
    if (!keyVal) return
    updateKey(i, { status: 'checking', error: null })
    const result = await checkTinypngKey(keyVal)
    if (result.valid) {
      updateKey(i, {
        status: 'valid',
        compressionCount: result.compressionCount,
        error: result.error || null
      })
    } else {
      updateKey(i, { status: 'invalid', error: result.error })
    }
  }

  const addFiles = async () => {
    const files = await openFiles({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    })
    if (files.length > 0) {
      setPaths((prev) => [...new Set([...prev, ...files])])
    }
  }

  const addDirectory = async () => {
    const dir = await openDirectory()
    if (dir) setPaths((prev) => [...new Set([...prev, dir])])
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
  const startCompress = (filesToProcess, { isRetry = false } = {}) => {
    const targetFiles = filesToProcess ?? paths
    const validKeys = keys.map((k) => k.value.trim()).filter(Boolean)
    if (validKeys.length === 0) return alert('请先填写 TinyPNG API Key')
    if (targetFiles.length === 0) return alert('请先添加文件或目录')

    // 全新开始时清空日志；继续/重试时保留已有日志
    if (!filesToProcess) {
      setLogs([])
      setStats(null)
      setActiveTab('log')
    }
    setPaused(null)
    setTotal(0)
    setRunning(true)

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
    })
    const cleanKeyCount = onImageKeyCount(({ key, compressionCount }) => {
      setKeys((prev) =>
        prev.map((k) => (k.value.trim() === key ? { ...k, status: 'valid', compressionCount } : k))
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
      // 任务完成后清理所有 IPC 监听器，防止泄漏
      cleanup()
    })
    const cleanPaused = onImagePaused(({ remaining }) => {
      // Key 全部耗尽：暂停任务，保存剩余文件列表，等待用户添加新 Key 后继续
      setPaused({ remaining })
      setRunning(false)
      cleanup()
    })

    compressImage({ paths: targetFiles, apiKeys: validKeys, recursive })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden px-7 py-6 gap-4">
        {/* API Keys */}
        <section className="bg-white/72 rounded-3xl border border-white/70 shadow-sm shadow-stone-900/5 p-5 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-stone-700 flex items-center gap-1.5">
              API Keys
              <Tooltip
                text={
                  <>
                    每个账号每月免费压缩 <span className="font-bold text-yellow-300">500</span>{' '}
                    次，可注册多个账号叠加使用
                  </>
                }
              />
              <a
                href="https://tinify.com/developers"
                className="ml-1 text-xs font-normal text-emerald-700 underline cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  openExternal('https://tinify.com/developers')
                }}
              >
                申请
              </a>
            </label>
            <button
              onClick={addKey}
              disabled={running}
              className="text-xs px-2.5 py-1 bg-stone-50 text-stone-600 rounded-2xl hover:bg-stone-100 border border-stone-200 transition-colors disabled:opacity-50"
            >
              + 添加 Key
            </button>
          </div>

          <div className="space-y-2">
            {keys.map((k, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={k.value}
                  onChange={(e) =>
                    updateKey(i, {
                      value: e.target.value,
                      status: 'idle',
                      compressionCount: null,
                      error: null
                    })
                  }
                  placeholder="your-api-key"
                  disabled={running}
                  className={`flex-1 text-xs border rounded-2xl px-3 py-2 font-mono outline-none transition-colors disabled:opacity-50 ${
                    k.status === 'valid'
                      ? 'border-green-300 focus:border-green-400'
                      : k.status === 'invalid'
                        ? 'border-red-300 focus:border-red-400'
                        : 'border-stone-200 focus:border-lime-400'
                  }`}
                />

                {/* 剩余次数徽标 */}
                {k.status === 'valid' && k.compressionCount !== null && (
                  <span
                    className={`shrink-0 text-xs px-2 py-1 rounded-2xl font-medium tabular-nums ${
                      KEY_LIMIT - k.compressionCount <= 50
                        ? 'bg-orange-50 text-orange-600'
                        : 'bg-emerald-50 text-emerald-600'
                    }`}
                    title={`已用 ${k.compressionCount} / ${KEY_LIMIT}`}
                  >
                    剩余 {KEY_LIMIT - k.compressionCount}
                  </span>
                )}
                {k.status === 'invalid' && (
                  <span className="shrink-0 text-xs text-red-500 max-w-28 truncate" title={k.error}>
                    {k.error}
                  </span>
                )}
                {k.status === 'valid' && k.error && (
                  <span className="shrink-0 text-xs text-orange-500">{k.error}</span>
                )}

                {/* 验证按钮 */}
                <button
                  onClick={() => checkKey(i)}
                  disabled={!k.value.trim() || k.status === 'checking' || running}
                  className="shrink-0 text-xs px-2.5 py-1.5 bg-lime-100 text-stone-950 rounded-2xl hover:bg-lime-200 disabled:opacity-40 transition-colors"
                >
                  {k.status === 'checking' ? '…' : '验证'}
                </button>

                {/* 删除按钮 */}
                <button
                  onClick={() => removeKey(i)}
                  disabled={running}
                  className="shrink-0 text-stone-300 hover:text-red-400 text-sm disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

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
                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold bg-stone-950 text-white hover:bg-stone-800 transition-colors"
              >
                ▶ 继续压缩（{paused.remaining.length} 张）
              </button>
              <button
                onClick={() => setPaused(null)}
                className="px-4 py-2.5 rounded-2xl text-sm text-stone-500 hover:text-red-500 border border-stone-200 hover:border-red-200 transition-colors"
              >
                放弃
              </button>
            </div>
          </>
        ) : running ? (
          <button
            onClick={() => stopImageCompression()}
            className="w-full py-2.5 rounded-2xl text-sm font-semibold transition-colors shrink-0 bg-yellow-500 text-white hover:bg-yellow-600"
          >
            ⏸ 暂停 ({logs.length}/{total})
          </button>
        ) : (
          <button
            onClick={() => startCompress()}
            disabled={running}
            className="w-full py-2.5 rounded-2xl text-sm font-semibold transition-colors shrink-0 bg-stone-950 text-white hover:bg-stone-800"
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
              <div className="flex items-center gap-3">
                {activeTab === 'log' && !running && logs.some((l) => l.status === 'error') && (
                  <button
                    onClick={() =>
                      startCompress(
                        logs.filter((l) => l.status === 'error').map((l) => l.file),
                        { isRetry: true }
                      )
                    }
                    className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                  >
                    重试失败 ({logs.filter((l) => l.status === 'error').length})
                  </button>
                )}
                <span className="text-xs text-stone-400">
                  {logs.length} / {total}
                </span>
              </div>
            </div>
            {activeTab === 'log' ? (
              <ul ref={logRef} className="flex-1 overflow-y-auto divide-y divide-stone-100">
                {logs.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 px-4 py-1.5">
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASS[item.status] || STATUS_CLASS.pending}`}
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
                          className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-400 hover:bg-red-100 disabled:opacity-30 transition-colors"
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
