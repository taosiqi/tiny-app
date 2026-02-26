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
  success: 'bg-green-100 text-green-700',
  skipped: 'bg-yellow-100 text-yellow-700',
  error: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-500'
}

/** 从完整路径中提取文件名（兼容 Windows 反斜杠） */
function basename(p) {
  return p.replace(/\\/g, '/').split('/').pop()
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
    const result = await window.api.checkTinypngKey(keyVal)
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
    const files = await window.api.openFiles({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    })
    if (files.length > 0) {
      setPaths((prev) => [...new Set([...prev, ...files])])
    }
  }

  const addDirectory = async () => {
    const dir = await window.api.openDirectory()
    if (dir) setPaths((prev) => [...new Set([...prev, dir])])
  }

  const removePath = (p) => setPaths((prev) => prev.filter((x) => x !== p))

  /**
   * 开始批量压缩
   *
   * @param {string[]} [filesToProcess] 传入时为"继续压缩"场景，使用指定文件列表；
   *                                    不传时为全新压缩，使用 paths 状态。
   */
  const startCompress = (filesToProcess) => {
    const targetFiles = filesToProcess ?? paths
    const validKeys = keys.map((k) => k.value.trim()).filter(Boolean)
    if (validKeys.length === 0) return alert('请先填写 TinyPNG API Key')
    if (targetFiles.length === 0) return alert('请先添加文件或目录')

    // 全新开始时清空日志；继续压缩时保留已有日志（追加新结果）
    if (!filesToProcess) {
      setLogs([])
      setStats(null)
    }
    setPaused(null)
    setTotal(0)
    setRunning(true)

    const cleanTotal = window.api.onImageTotal((n) => {
      setTotal(n)
    })
    const cleanProgress = window.api.onImageProgress((item) => {
      setLogs((prev) => [...prev, item])
      scrollBottom()
    })
    const cleanKeyCount = window.api.onImageKeyCount(({ key, compressionCount }) => {
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
    const cleanDone = window.api.onImageDone((s) => {
      setStats(s)
      setRunning(false)
      // 任务完成后清理所有 IPC 监听器，防止泄漏
      cleanup()
    })
    const cleanPaused = window.api.onImagePaused(({ remaining }) => {
      // Key 全部耗尽：暂停任务，保存剩余文件列表，等待用户添加新 Key 后继续
      setPaused({ remaining })
      setRunning(false)
      cleanup()
    })

    window.api.compressImage({ paths: targetFiles, apiKeys: validKeys })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <span>🖼</span> 图片压缩
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">使用 TinyPNG API 压缩 PNG / JPG / JPEG 图片</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* API Keys */}
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">
              API Keys
              <a
                href="https://tinify.com/developers"
                className="ml-2 text-xs font-normal text-blue-500 underline cursor-pointer"
                onClick={(e) => {
                  e.preventDefault()
                  window.api.openExternal('https://tinify.com/developers')
                }}
              >
                申请
              </a>
            </label>
            <button
              onClick={addKey}
              disabled={running}
              className="text-xs px-2.5 py-1 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 border border-gray-200 transition-colors disabled:opacity-50"
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
                  className={`flex-1 text-xs border rounded-lg px-3 py-2 font-mono outline-none transition-colors disabled:opacity-50 ${
                    k.status === 'valid'
                      ? 'border-green-300 focus:border-green-400'
                      : k.status === 'invalid'
                        ? 'border-red-300 focus:border-red-400'
                        : 'border-gray-200 focus:border-blue-400'
                  }`}
                />

                {/* 剩余次数徽标 */}
                {k.status === 'valid' && k.compressionCount !== null && (
                  <span
                    className={`shrink-0 text-xs px-2 py-1 rounded-lg font-medium tabular-nums ${
                      KEY_LIMIT - k.compressionCount <= 50
                        ? 'bg-orange-50 text-orange-600'
                        : 'bg-green-50 text-green-600'
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
                  className="shrink-0 text-xs px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-40 transition-colors"
                >
                  {k.status === 'checking' ? '…' : '验证'}
                </button>

                {/* 删除按钮 */}
                <button
                  onClick={() => removeKey(i)}
                  disabled={running}
                  className="shrink-0 text-gray-300 hover:text-red-400 text-sm disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

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
              点击上方按钮添加图片文件或目录
            </div>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {paths.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 text-xs">📄</span>
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

        {/* Start button / Paused state */}
        {paused ? (
          <>
            {/* 暂停提示 */}
            <section className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-sm text-orange-800">
              ⚠️ 所有 API Key 已达当月上限，还有{' '}
              <span className="font-bold">{paused.remaining.length}</span> 张图片未处理。
              请在上方添加新 Key 后点击继续。
            </section>
            <div className="flex gap-3">
              <button
                onClick={() => startCompress(paused.remaining)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                ▶ 继续压缩（{paused.remaining.length} 张）
              </button>
              <button
                onClick={() => setPaused(null)}
                className="px-4 py-2.5 rounded-xl text-sm text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 transition-colors"
              >
                放弃
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={() => startCompress()}
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
        )}

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
                    className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CLASS[item.status] || STATUS_CLASS.pending}`}
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
