/**
 * @file AudioTool.jsx
 * @description 音频压缩工具组件，支持取消、重试、日志筛选和压缩结果对比。
 */
import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ComparePanel from './ComparePanel'
import CompareFullscreen from './CompareFullscreen'
import PathPickerPanel from './PathPickerPanel'
import { AppButton, AppPanel } from './ui/base'
import { PageHeader, PageLayout } from './ui/page'
import { useToast } from '../toast/useToast'
import {
  compressAudio,
  onAudioDone,
  onAudioPaused,
  onAudioProgress,
  onAudioTotal,
  stopAudioCompression
} from '../api/desktop'
import { basename } from '../utils/fileUtils'
import { useSettings } from '../settings/useSettings'
import { audioPayload, audioSummary, cloneCompression } from '../settings/compressionSettings'
import { createTaskRecord, finishTaskRecord, updateTaskRecordStats, upsertTaskRecord } from '../tasks/taskHistory'

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

function statusText(status) {
  if (status === 'success') return '✓ 压缩'
  if (status === 'skipped') return '— 跳过'
  if (status === 'paused') return '暂停'
  if (status === 'cancelled') return '取消'
  return '✗ 失败'
}

export default function AudioTool() {
  const toast = useToast()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const compression = cloneCompression(settings.compression)
  const meta = FORMAT_META.mixed
  const [paths, setPaths] = useState([])
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [running, setRunning] = useState(false)
  const [total, setTotal] = useState(0)
  const [paused, setPaused] = useState(null)
  const [activeTab, setActiveTab] = useState('log')
  const [compareFullscreen, setCompareFullscreen] = useState(false)
  const [logFilter, setLogFilter] = useState('all')
  const taskRecordRef = useRef(null)
  const logRef = useRef(null)

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    }, 50)
  }, [])

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
    const taskRecord = createTaskRecord({
      source: 'audio',
      compressionSnapshot: compression,
      inputCount: targetFiles.length
    })
    taskRecordRef.current = taskRecord
    upsertTaskRecord(taskRecord)
    toast.info(isRetry ? `正在重试 ${targetFiles.length} 个失败项` : '开始压缩音频')

    const cleanTotal = onAudioTotal((count) => {
      setTotal(count)
      if (taskRecordRef.current) {
        const next = updateTaskRecordStats(taskRecordRef.current, taskRecordRef.current.logs, count)
        taskRecordRef.current = next
        upsertTaskRecord(next)
      }
    })
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
      const record = taskRecordRef.current
      if (record) {
        const next = updateTaskRecordStats(record, [...record.logs, item])
        taskRecordRef.current = next
        upsertTaskRecord(next)
      }
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
      if (taskRecordRef.current) upsertTaskRecord(finishTaskRecord(taskRecordRef.current, nextStats.failed > 0 ? 'error' : 'success', nextStats, taskRecordRef.current.logs))
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
          format: 'mixed',
          status: 'paused',
          error: `任务已暂停，剩余 ${remaining.length} 个文件`
        }
      ])
      if (taskRecordRef.current) {
        const pauseLog = {
          file: remaining[0] ?? `${meta.label}任务`,
          format: 'mixed',
          status: 'paused',
          error: `任务已暂停，剩余 ${remaining.length} 个文件`
        }
        const next = updateTaskRecordStats(taskRecordRef.current, [...taskRecordRef.current.logs, pauseLog])
        taskRecordRef.current = finishTaskRecord(next, 'paused', next.stats, next.logs)
        upsertTaskRecord(taskRecordRef.current)
      }
      cleanup()
    })

    try {
      await compressAudio(audioPayload(targetFiles, compression))
    } catch (error) {
      setRunning(false)
      toast.error(`音频压缩失败：${error?.message ?? error}`)
      setLogs((prev) => [
        ...prev,
        {
          file: targetFiles[0] ?? `${meta.label}任务`,
          format: 'mixed',
          status: 'error',
          error: error?.message ?? String(error)
        }
      ])
      cleanup()
      if (taskRecordRef.current) {
        const nextLogs = [...taskRecordRef.current.logs, { file: targetFiles[0] ?? `${meta.label}任务`, format: 'mixed', status: 'error', error: error?.message ?? String(error) }]
        upsertTaskRecord(finishTaskRecord(taskRecordRef.current, 'error', taskRecordRef.current.stats, nextLogs))
      }
    }
  }

  const visibleLogs = logs.filter((item) => logFilter === 'all' || item.status === logFilter)
  const errorLogs = logs.filter((item) => item.status === 'error')
  const successCount = logs.filter((item) => item.status === 'success').length
  const skippedCount = logs.filter((item) => item.status === 'skipped').length

  return (
    <PageLayout>
      {compareFullscreen && <CompareFullscreen logs={logs} onClose={() => setCompareFullscreen(false)} />}
      <PageHeader
        title={meta.label}
        description={meta.desc}
        actions={<AppButton type="button" variant="ghost" onClick={() => navigate('/settings')} className="px-3 py-1.5 text-xs">修改压缩设置</AppButton>}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <PathPickerPanel
          paths={paths}
          running={running}
          filters={[meta.filter]}
          emptyText={`点击上方按钮添加 ${meta.ext} 文件或目录`}
          onChange={setPaths}
          footer={<p className="mt-3 text-xs text-stone-500">{audioSummary(compression)}，递归子目录：{compression.audio.recursiveScan ? '开启' : '关闭'}</p>}
        />

        {paused ? (
          <>
            <section className="shrink-0 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              任务已暂停，还有 <span className="font-bold">{paused.remaining.length}</span> 个音频文件未处理。
            </section>
            <div className="flex shrink-0 gap-3">
              <AppButton
                onClick={() => startCompress(paused.remaining)}
                variant="primary"
                className="flex-1 py-2.5 text-sm"
              >
                继续压缩（{paused.remaining.length} 个）
              </AppButton>
              <AppButton
                onClick={() => {
                  setPaused(null)
                  toast.info('已放弃剩余音频任务')
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
              toast.info('正在暂停音频压缩')
              stopAudioCompression().catch((error) => toast.error(`暂停失败：${error?.message ?? error}`))
            }}
            variant="danger"
            className="w-full shrink-0 py-2.5 text-sm"
          >
            暂停 ({logs.length}/{total})
          </AppButton>
        ) : (
          <AppButton
            onClick={() => startCompress()}
            variant="primary"
            className="w-full shrink-0 py-2.5 text-sm"
          >
            开始压缩
          </AppButton>
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
          <AppPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          </AppPanel>
        )}
      </div>
    </PageLayout>
  )
}
