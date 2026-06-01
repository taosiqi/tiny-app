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
import { useState, useRef, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ComparePanel from './ComparePanel'
import CompareFullscreen from './CompareFullscreen'
import PathPickerPanel from './PathPickerPanel'
import { AppButton, AppPanel, StatusPill } from './ui/base'
import { PageHeader, PageLayout } from './ui/page'
import { useToast } from '../toast/useToast'
import {
  compressImage,
  onImageDone,
  onImageKeyCount,
  onImagePaused,
  onImageProgress,
  onImageTotal,
  stopImageCompression
} from '../api/desktop'
import { KEY_LIMIT, useTinypngKeys } from '../tinypng/useTinypngKeys'
import { basename } from '../utils/fileUtils'
import { useSettings } from '../settings/useSettings'
import { cloneCompression, imagePayload } from '../settings/compressionSettings'
import { createTaskRecord, finishTaskRecord, updateTaskRecordStats, upsertTaskRecord } from '../tasks/taskHistory'

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
  const location = useLocation()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const compression = cloneCompression(settings.compression)
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
  const taskRecordRef = useRef(null)
  const logRef = useRef(null)
  const retryTokenRef = useRef(null)

  useEffect(() => {
    const retryToken = location.state?.retryToken
    const retryPaths = location.state?.retryPaths
    if (!retryToken || retryTokenRef.current === retryToken || !Array.isArray(retryPaths)) return
    retryTokenRef.current = retryToken
    setPaths((items) => [...new Set([...items, ...retryPaths])])
    toast.info(`已加入 ${retryPaths.length} 个待重试图片`)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate, toast])

  /** 将日志容器滚动到底部（延迟 50ms 等待 DOM 更新） */
  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

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
    if (compression.image.engine === 'tinify' && validKeys.length === 0) {
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
      compressionSnapshot: compression,
      inputCount: targetFiles.length
    })
    taskRecordRef.current = taskRecord
    upsertTaskRecord(taskRecord)
    toast.info(isRetry ? `正在重试 ${targetFiles.length} 个失败项` : '开始压缩图片')

    const cleanTotal = onImageTotal((n) => {
      setTotal(n)
      if (taskRecordRef.current) {
        const next = updateTaskRecordStats(taskRecordRef.current, taskRecordRef.current.logs, n)
        taskRecordRef.current = next
        upsertTaskRecord(next)
      }
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
        const next = updateTaskRecordStats(record, [...record.logs, item])
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
      if (s.failed === 0 && s.skipped === 0) setPaths([])
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
      await compressImage(imagePayload(targetFiles, compression, validKeys))
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
  const checkedKeys = keys.filter((key) => key.status === 'valid')
  const usableKeys = checkedKeys.filter((key) => (key.compressionCount ?? 0) < KEY_LIMIT)
  const remainingQuota = usableKeys.reduce((sum, key) => sum + Math.max(0, KEY_LIMIT - (key.compressionCount ?? 0)), 0)
  const checkingKeys = keys.filter((key) => key.status === 'checking').length
  const imageEngine = compression.image.engine

  return (
    <PageLayout>
      {compareFullscreen && (
        <CompareFullscreen logs={logs} onClose={() => setCompareFullscreen(false)} />
      )}
      <PageHeader title="图片压缩" description="压缩 PNG、JPEG、WebP 和 AVIF 图片。" />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <AppPanel className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
            <span className="font-bold text-stone-800">
              {imageEngine === 'local' ? '本地压缩 · 离线可用' : imageEngine === 'tinify' ? 'Tinify API' : '自动选择'}
            </span>
            {imageEngine !== 'local' && <>
              <StatusPill tone={usableKeys.length > 0 ? 'success' : checkingKeys > 0 ? 'info' : 'warning'}>
                {checkingKeys > 0 ? `正在校验 ${checkingKeys} 个` : `可用 Key ${usableKeys.length} 个`}
              </StatusPill>
              <span>剩余额度合计 {remainingQuota} 次</span>
            </>}
          </div>
          {imageEngine !== 'local' && <AppButton type="button" variant="ghost" onClick={() => navigate('/settings?tab=image')} className="px-3 py-1.5 text-xs">
            管理 Key
          </AppButton>}
        </AppPanel>

        {/* Paths */}
        <PathPickerPanel
          paths={paths}
          running={running}
          filters={[{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'] }]}
          emptyText="点击上方按钮添加图片文件或目录"
          onChange={setPaths}
          compact
          footer={<p className="mt-3 text-xs text-stone-500">
            递归子目录：{compression.image.recursiveScan ? '开启' : '关闭'}，可在首选项中修改。
          </p>}
        />

        {/* Start button / Paused state */}
        {paused ? (
          <>
            {/* 暂停提示 */}
            <section className="shrink-0 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              {keys
                .filter((k) => k.status === 'valid')
                .every((k) => k.compressionCount >= KEY_LIMIT) ? (
                <>
                  所有 API Key 已达当月上限，还有{' '}
                  <span className="font-bold">{paused.remaining.length}</span> 张图片未处理。
                  请在上方添加新 Key 后点击继续。
                </>
              ) : (
                <>
                  任务已暂停，还有 <span className="font-bold">{paused.remaining.length}</span>{' '}
                  张图片未处理。
                </>
              )}
            </section>
            <div className="flex gap-3 shrink-0">
              <AppButton
                onClick={() => startCompress(paused.remaining)}
                variant="primary"
                className="flex-1 py-2.5 text-sm"
              >
                继续压缩（{paused.remaining.length} 张）
              </AppButton>
              <AppButton
                onClick={() => {
                  setPaused(null)
                  toast.info('已放弃剩余图片任务')
                }}
                variant="danger"
                className="px-4 py-2.5 text-sm"
              >
                放弃
              </AppButton>
            </div>
          </>
        ) : running ? (
          <AppButton
            onClick={() => {
              toast.info('正在暂停图片压缩')
              stopImageCompression().catch((error) =>
                toast.error(`暂停失败：${error?.message ?? error}`)
              )
            }}
            variant="danger"
            className="w-full shrink-0 py-2.5 text-sm"
          >
            暂停 ({logs.length}/{total})
          </AppButton>
        ) : (
          <AppButton
            onClick={() => startCompress()}
            disabled={running}
            variant="primary"
            className="w-full shrink-0 py-2.5 text-sm"
          >
            开始压缩
          </AppButton>
        )}

        {/* Stats — 紧凑横条，位于日志区上方 */}
        {stats && (
          <section className="shrink-0 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 flex items-center gap-4 flex-wrap">
            <span className="shrink-0 text-xs font-semibold text-emerald-900">压缩完成</span>
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
          <AppPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                    {item.engine && <StatusPill tone={item.engine === 'local' ? 'neutral' : 'info'}>{item.engine === 'local' ? '本地' : 'Tinify'}</StatusPill>}
                    {item.warnings?.length > 0 && <span className="max-w-48 truncate text-xs text-amber-600" title={item.warnings.join('；')}>{item.warnings.join('；')}</span>}
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
          </AppPanel>
        )}
      </div>
    </PageLayout>
  )
}
