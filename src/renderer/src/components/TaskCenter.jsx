import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ComparePanel from './ComparePanel'
import RuntimeHealthPanel from './RuntimeHealthPanel'
import { useToast } from '../toast/useToast'
import {
  compressAudio,
  compressImage,
  onAudioDone,
  onAudioPaused,
  onAudioProgress,
  onAudioTotal,
  onImageDone,
  onImageKeyCount,
  onImagePaused,
  onImageProgress,
  onImageTotal,
  openDirectory,
  openFiles,
  restoreFile,
  stopAudioCompression,
  stopImageCompression
} from '../api/desktop'
import { basename } from '../utils/fileUtils'
import {
  addTaskHistory,
  clearTaskHistory,
  loadTaskHistory,
  saveTaskHistory
} from '../tasks/taskHistory'
import { DEFAULT_TASK_PRESET, TASK_PRESETS } from '../tasks/taskPresets'
import { getValidTinypngKeyValues, useTinypngKeys } from '../tinypng/useTinypngKeys'
import { useSettings } from '../settings/useSettings'
import { AppButton, AppCard, AppInput, AppPanel, AppSelect, AppTabs, EmptyState } from './ui/base'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg']
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav']
const REPORT_COLUMNS = [
  'kind',
  'status',
  'file',
  'backupPath',
  'inputSize',
  'outputSize',
  'saved',
  'reason',
  'error'
]

function getExtension(path) {
  const name = path.split(/[\\/]/).pop() ?? ''
  const parts = name.split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

function classifyPath(path) {
  const ext = getExtension(path)
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'
  return 'unknown'
}

function groupPaths(paths) {
  const image = []
  const audio = []
  const unknown = []
  paths.forEach((path) => {
    const kind = classifyPath(path)
    if (kind === 'image') image.push(path)
    else if (kind === 'audio') audio.push(path)
    else unknown.push(path)
  })
  return { image, audio, unknown }
}

function statusClass(status) {
  if (status === 'success') return 'bg-emerald-100 text-emerald-700'
  if (status === 'skipped') return 'bg-yellow-100 text-yellow-700'
  if (status === 'error') return 'bg-red-100 text-red-700'
  if (status === 'paused') return 'bg-orange-50 text-orange-600'
  if (status === 'running') return 'bg-sky-100 text-sky-700'
  return 'bg-stone-100 text-stone-500'
}

function sumStats(imageStats, audioStats) {
  return {
    total: (imageStats?.total ?? 0) + (audioStats?.total ?? 0),
    processed: (imageStats?.processed ?? 0) + (audioStats?.processed ?? 0),
    skipped: (imageStats?.skipped ?? 0) + (audioStats?.skipped ?? 0),
    failed: (imageStats?.failed ?? 0) + (audioStats?.failed ?? 0)
  }
}

function escapeCsv(value) {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function buildCsv(logs) {
  return [
    REPORT_COLUMNS.join(','),
    ...logs.map((item) => REPORT_COLUMNS.map((column) => escapeCsv(item[column])).join(','))
  ].join('\n')
}

export default function TaskCenter() {
  const toast = useToast()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [paths, setPaths] = useState([])
  const { keys, setKeys } = useTinypngKeys()
  const [presetOverride, setPresetOverride] = useState(null)
  const preset = presetOverride ?? settings.taskPreset ?? DEFAULT_TASK_PRESET
  const [recursive, setRecursive] = useState(true)
  const [running, setRunning] = useState(false)
  const [currentKind, setCurrentKind] = useState(null)
  const [totals, setTotals] = useState({ image: 0, audio: 0 })
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState(() => loadTaskHistory())
  const [activePanel, setActivePanel] = useState('queue')
  const [historyFilter, setHistoryFilter] = useState('all')
  const [historyQuery, setHistoryQuery] = useState('')
  const latestLogsRef = useRef([])

  useEffect(() => {
    latestLogsRef.current = logs
  }, [logs])

  const grouped = useMemo(() => {
    return groupPaths(paths)
  }, [paths])

  const validKeys = useMemo(() => getValidTinypngKeyValues(keys), [keys])

  const addFiles = async () => {
    const files = await openFiles({
      filters: [
        { name: 'TinyPress 支持文件', extensions: [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS] }
      ]
    })
    if (files.length > 0) {
      setPaths((prev) => [...new Set([...prev, ...files])])
      toast.info(`已加入 ${files.length} 个文件`)
    }
  }

  const addDirectory = async () => {
    const dir = await openDirectory()
    if (dir) {
      setPaths((prev) => [...new Set([...prev, dir])])
      toast.info('已加入目录，运行时会按文件类型自动处理')
    }
  }

  const removePath = (path) => setPaths((prev) => prev.filter((item) => item !== path))

  const appendLog = (kind, item) => {
    setLogs((prev) => {
      const next = [...prev, { ...item, kind }]
      latestLogsRef.current = next
      return next
    })
  }

  const runImageBatch = (targetPaths) =>
    new Promise((resolve, reject) => {
      let settled = false
      const cleanTotal = onImageTotal((count) => setTotals((prev) => ({ ...prev, image: count })))
      const cleanProgress = onImageProgress((item) => appendLog('image', item))
      const cleanKeyCount = onImageKeyCount(({ key, compressionCount }) => {
        setKeys((prev) =>
          prev.map((item) => (item.value?.trim() === key ? { ...item, compressionCount } : item))
        )
      })
      const cleanDone = onImageDone((nextStats) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ status: 'done', stats: nextStats })
      })
      const cleanPaused = onImagePaused(({ remaining }) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ status: 'paused', remaining, stats: null })
      })
      const cleanup = () => {
        cleanTotal()
        cleanProgress()
        cleanKeyCount()
        cleanDone()
        cleanPaused()
      }

      compressImage({ paths: targetPaths, apiKeys: validKeys, recursive }).catch((error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
    })

  const runAudioBatch = (targetPaths) =>
    new Promise((resolve, reject) => {
      let settled = false
      const cleanTotal = onAudioTotal((count) => setTotals((prev) => ({ ...prev, audio: count })))
      const cleanProgress = onAudioProgress((item) => appendLog('audio', item))
      const cleanDone = onAudioDone((nextStats) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ status: 'done', stats: nextStats })
      })
      const cleanPaused = onAudioPaused(({ remaining }) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ status: 'paused', remaining, stats: null })
      })
      const cleanup = () => {
        cleanTotal()
        cleanProgress()
        cleanDone()
        cleanPaused()
      }

      compressAudio({ paths: targetPaths, format: 'mixed', recursive }).catch((error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      })
    })

  const startBatch = async (overridePaths = null) => {
    const batchPaths = overridePaths ?? paths
    const batchGrouped = groupPaths(batchPaths)
    const directoryTargets = batchGrouped.unknown.filter((path) => !getExtension(path))

    if (batchPaths.length === 0) {
      toast.warning('请先添加文件或目录')
      return
    }
    const imageTargets =
      validKeys.length > 0 ? [...batchGrouped.image, ...directoryTargets] : batchGrouped.image
    const audioTargets = [...batchGrouped.audio, ...directoryTargets]

    if (imageTargets.length > 0 && validKeys.length === 0) {
      toast.warning('图片压缩需要先在“图片压缩”页填写 TinyPNG API Key')
      return
    }

    setRunning(true)
    setCurrentKind(null)
    setTotals({ image: 0, audio: 0 })
    setLogs([])
    latestLogsRef.current = []
    setStats(null)
    setActivePanel('queue')

    const startedAt = new Date().toISOString()
    let imageResult = null
    let audioResult = null
    let activeKind = null

    try {
      if (imageTargets.length > 0) {
        activeKind = 'image'
        setCurrentKind('image')
        imageResult = await runImageBatch(imageTargets)
        if (imageResult.status === 'paused') {
          const pausedStats = sumStats(imageResult.stats, audioResult?.stats)
          setStats(pausedStats)
          toast.warning(`图片任务已暂停，剩余 ${imageResult.remaining.length} 个文件`)
          return
        }
      }
      if (audioTargets.length > 0) {
        activeKind = 'audio'
        setCurrentKind('audio')
        audioResult = await runAudioBatch(audioTargets)
        if (audioResult.status === 'paused') {
          const pausedStats = sumStats(imageResult?.stats, audioResult.stats)
          setStats(pausedStats)
          toast.warning(`音频任务已暂停，剩余 ${audioResult.remaining.length} 个文件`)
          return
        }
      }

      const nextStats = sumStats(imageResult?.stats, audioResult?.stats)
      setStats(nextStats)
      const record = {
        id: `${Date.now()}`,
        preset,
        startedAt,
        finishedAt: new Date().toISOString(),
        stats: nextStats,
        logs: latestLogsRef.current,
        inputCount: batchPaths.length,
        unknownCount: batchGrouped.unknown.length
      }
      setHistory(addTaskHistory(record))
      toast.success(
        `任务完成：成功 ${nextStats.processed}，失败 ${nextStats.failed}，跳过 ${nextStats.skipped}`
      )
    } catch (error) {
      appendLog(activeKind ?? 'task', {
        status: 'error',
        file: batchPaths[0] ?? 'TinyPress 任务',
        error: error?.message ?? String(error)
      })
      toast.error(`任务失败：${error?.message ?? error}`)
    } finally {
      setCurrentKind(null)
      setRunning(false)
    }
  }

  const stopBatch = async () => {
    if (currentKind === 'image') await stopImageCompression()
    if (currentKind === 'audio') await stopAudioCompression()
    toast.info('正在暂停当前任务')
  }

  const clearHistory = () => {
    setHistory(clearTaskHistory())
    toast.info('已清空任务历史')
  }

  const deleteHistory = (id) => {
    const next = history.filter((item) => item.id !== id)
    setHistory(saveTaskHistory(next))
  }

  const retryFailed = () => {
    const retryPaths = [
      ...new Set(logs.filter((item) => item.status === 'error').map((item) => item.file))
    ]
    if (retryPaths.length === 0) {
      toast.info('没有需要重试的失败项')
      return
    }
    startBatch(retryPaths)
  }

  const restoreSuccess = async () => {
    const restorable = logs.filter((item) => item.status === 'success' && item.backupPath)
    if (restorable.length === 0) {
      toast.info('没有可还原的成功记录')
      return
    }
    if (!window.confirm(`确认还原 ${restorable.length} 个文件吗？当前文件会被备份覆盖。`)) return

    let restored = 0
    let failed = 0
    for (const item of restorable) {
      try {
        await restoreFile(item.backupPath, item.file)
        restored += 1
      } catch {
        failed += 1
      }
    }
    if (failed > 0) toast.warning(`已还原 ${restored} 个文件，失败 ${failed} 个`)
    else toast.success(`已还原 ${restored} 个文件`)
  }

  const exportReport = (format = 'json') => {
    const payload = {
      exportedAt: new Date().toISOString(),
      preset,
      stats,
      logs
    }
    if (logs.length === 0) {
      toast.warning('没有可导出的任务结果')
      return
    }
    const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
    if (format === 'csv') {
      downloadText(`tinypress-report-${stamp}.csv`, buildCsv(logs), 'text/csv;charset=utf-8')
    } else {
      downloadText(
        `tinypress-report-${stamp}.json`,
        JSON.stringify(payload, null, 2),
        'application/json;charset=utf-8'
      )
    }
    toast.success('报告已导出')
  }

  const filteredHistory = history.filter((item) => {
    const query = historyQuery.trim().toLowerCase()
    const statusMatch =
      historyFilter === 'all' ||
      (historyFilter === 'failed' && (item.stats?.failed ?? 0) > 0) ||
      (historyFilter === 'success' && (item.stats?.failed ?? 0) === 0)
    const textMatch =
      !query ||
      (item.logs ?? []).some((log) => log.file?.toLowerCase().includes(query)) ||
      TASK_PRESETS[item.preset]?.label?.toLowerCase().includes(query)
    return statusMatch && textMatch
  })

  const successLogs = logs.filter((item) => item.status === 'success')
  const failedLogs = logs.filter((item) => item.status === 'error')
  const totalPlanned = paths.length

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-5 md:px-7 md:py-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(320px,0.92fr)_minmax(360px,1.08fr)] lg:overflow-hidden">
        <AppPanel className="flex min-h-0 flex-col overflow-hidden p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-stone-800">任务中心</h3>
              <p className="mt-1 text-xs text-stone-500">
                统一加入文件，按类型自动分派图片与音频压缩。
              </p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(TASK_PRESETS).map(([id, item]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPresetOverride(id)}
                disabled={running}
                className={`app-card rounded-2xl border px-3 py-2 text-left transition-colors ${
                  preset === id ? 'app-card-active' : 'interactive-ghost'
                }`}
              >
                <span className="block text-xs font-bold text-stone-800">{item.label}</span>
                <span className="mt-1 block text-[11px] leading-4 text-stone-500">{item.desc}</span>
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-stone-700">输入队列</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addFiles}
                disabled={running}
                className="interactive-button rounded-2xl bg-sky-100 px-3 py-1.5 text-xs text-stone-950 disabled:opacity-50"
              >
                + 添加文件
              </button>
              <button
                type="button"
                onClick={addDirectory}
                disabled={running}
                className="interactive-button rounded-2xl bg-sky-100 px-3 py-1.5 text-xs text-stone-950 disabled:opacity-50"
              >
                + 添加目录
              </button>
            </div>
          </div>

          {paths.length === 0 ? (
            <EmptyState className="flex flex-1 items-center justify-center">
              添加 PNG、JPG、MP3、OGG、WAV 文件或目录
            </EmptyState>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {paths.map((path) => {
                const kind = classifyPath(path)
                return (
                  <li
                    key={path}
                    className="app-card flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm"
                  >
                    <span className="w-10 shrink-0 text-[11px] font-black text-stone-400">
                      {kind === 'image' ? 'IMG' : kind === 'audio' ? 'AUD' : 'DIR'}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-xs text-stone-700"
                      title={path}
                    >
                      {path}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePath(path)}
                      disabled={running}
                      className="interactive-danger shrink-0 rounded-full px-1.5 text-xs text-stone-300 disabled:opacity-30"
                    >
                      x
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2">
            <AppCard className="px-3 py-2">
              <span className="block text-[11px] text-stone-400">图片</span>
              <span className="text-lg font-black text-stone-900">{grouped.image.length}</span>
            </AppCard>
            <AppCard className="px-3 py-2">
              <span className="block text-[11px] text-stone-400">音频</span>
              <span className="text-lg font-black text-stone-900">{grouped.audio.length}</span>
            </AppCard>
            <AppCard className="px-3 py-2">
              <span className="block text-[11px] text-stone-400">目录/未知</span>
              <span className="text-lg font-black text-stone-900">{grouped.unknown.length}</span>
            </AppCard>
          </div>

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

          {running ? (
            <button
              type="button"
              onClick={stopBatch}
              className="mt-4 w-full shrink-0 rounded-2xl bg-yellow-500 py-2.5 text-sm font-semibold text-white hover:bg-yellow-600"
            >
              暂停当前任务
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startBatch()}
              className="interactive-button mt-4 w-full shrink-0 rounded-2xl bg-sky-100 py-2.5 text-sm font-semibold text-stone-950"
            >
              开始统一处理
            </button>
          )}
        </AppPanel>

        <AppPanel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-4 py-2.5">
            <AppTabs
              value={activePanel}
              onChange={setActivePanel}
              items={[
                ['queue', '处理日志'],
                ['compare', '结果对比'],
                ['history', '历史记录'],
                ['health', '健康面板']
              ].map(([id, label]) => ({ id, label }))}
            />
            <span className="text-xs text-stone-400">
              {running
                ? `${currentKind === 'image' ? '图片' : '音频'}处理中 ${logs.length}/${
                    currentKind === 'image'
                      ? totals.image || totalPlanned
                      : totals.audio || totalPlanned
                  }`
                : `${logs.length}/${totalPlanned || logs.length || 0}`}
            </span>
          </div>

          {activePanel === 'queue' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {stats && (
                <div className="m-4 mb-0 space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['总数', stats.total],
                      ['成功', stats.processed],
                      ['跳过', stats.skipped],
                      ['失败', stats.failed]
                    ].map(([label, value]) => (
                      <AppCard key={label} className="px-3 py-2">
                        <span className="block text-[11px] text-emerald-700">{label}</span>
                        <span className="text-lg font-black text-stone-900">{value}</span>
                      </AppCard>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <AppButton
                      type="button"
                      onClick={retryFailed}
                      disabled={running || failedLogs.length === 0}
                      variant="danger"
                      className="px-2.5 py-1.5 text-xs"
                    >
                      重试失败 ({failedLogs.length})
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={restoreSuccess}
                      disabled={running || successLogs.length === 0}
                      variant="secondary"
                      className="px-2.5 py-1.5 text-xs"
                    >
                      批量还原 ({successLogs.length})
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => exportReport('json')}
                      variant="primary"
                      className="px-2.5 py-1.5 text-xs"
                    >
                      导出 JSON
                    </AppButton>
                    <AppButton
                      type="button"
                      onClick={() => exportReport('csv')}
                      variant="secondary"
                      className="px-2.5 py-1.5 text-xs"
                    >
                      导出 CSV
                    </AppButton>
                  </div>
                </div>
              )}

              {logs.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-4">
                  <EmptyState>任务启动后会在这里实时显示每个文件的结果</EmptyState>
                </div>
              ) : (
                <ul className="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto">
                  {logs.map((item, index) => (
                    <li key={`${item.file}-${index}`} className="flex items-center gap-2 px-4 py-2">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(item.status)}`}
                      >
                        {item.status}
                      </span>
                      <span className="w-10 shrink-0 text-[11px] font-black text-stone-400">
                        {item.kind === 'image' ? 'IMG' : item.kind === 'audio' ? 'AUD' : 'TSK'}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-xs text-stone-600"
                        title={item.file}
                      >
                        {basename(item.file)}
                      </span>
                      {item.status === 'success' && (
                        <span className="shrink-0 text-xs text-emerald-600">
                          {item.inputSize}
                          {' -> '}
                          {item.outputSize}
                        </span>
                      )}
                      {item.status === 'skipped' && (
                        <span
                          className="max-w-48 shrink-0 truncate text-xs text-yellow-600"
                          title={item.reason}
                        >
                          {item.reason}
                        </span>
                      )}
                      {item.status === 'error' && (
                        <span
                          className="max-w-48 shrink-0 truncate text-xs text-red-500"
                          title={item.error}
                        >
                          {item.error}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activePanel === 'compare' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {successLogs.length > 0 ? (
                <ComparePanel logs={successLogs} />
              ) : (
                <EmptyState className="flex h-full items-center justify-center">
                  有成功压缩记录后可在这里查看压缩前后对比
                </EmptyState>
              )}
            </div>
          )}

          {activePanel === 'history' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-bold text-stone-800">
                  最近 {history.length} 次任务
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <AppInput
                    type="search"
                    value={historyQuery}
                    onChange={(event) => setHistoryQuery(event.target.value)}
                    placeholder="搜索路径"
                    aria-label="搜索历史路径"
                    className="w-32 py-1 text-xs"
                  />
                  <AppSelect
                    value={historyFilter}
                    onChange={(event) => setHistoryFilter(event.target.value)}
                    aria-label="历史筛选"
                    className="py-1 text-xs"
                  >
                    <option value="all">全部</option>
                    <option value="success">无失败</option>
                    <option value="failed">有失败</option>
                  </AppSelect>
                  <AppButton
                    type="button"
                    onClick={clearHistory}
                    disabled={history.length === 0}
                    variant="secondary"
                    className="rounded-xl px-2 py-1 text-xs"
                  >
                    清空历史
                  </AppButton>
                </div>
              </div>
              {filteredHistory.length === 0 ? (
                <EmptyState>暂无任务历史</EmptyState>
              ) : (
                <ul className="space-y-2">
                  {filteredHistory.map((item) => (
                    <AppCard key={item.id} as="li" className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-stone-800">
                            {new Date(item.finishedAt).toLocaleString('zh-CN')} ·{' '}
                            {TASK_PRESETS[item.preset]?.label ?? '任务'}
                          </div>
                          <div className="mt-1 text-xs text-stone-500">
                            输入 {item.inputCount}，成功 {item.stats.processed}，跳过{' '}
                            {item.stats.skipped}，失败 {item.stats.failed}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <AppButton
                            type="button"
                            onClick={() => {
                              setLogs(item.logs ?? [])
                              setStats(item.stats)
                              setActivePanel('compare')
                            }}
                            variant="primary"
                            className="px-2.5 py-1.5 text-xs"
                          >
                            查看
                          </AppButton>
                          <AppButton
                            type="button"
                            onClick={() => {
                              setLogs(item.logs ?? [])
                              setStats(item.stats)
                              setActivePanel('queue')
                            }}
                            variant="secondary"
                            className="px-2.5 py-1.5 text-xs"
                          >
                            载入
                          </AppButton>
                          <AppButton
                            type="button"
                            onClick={() => deleteHistory(item.id)}
                            variant="danger"
                            className="px-2.5 py-1.5 text-xs"
                          >
                            删除
                          </AppButton>
                        </div>
                      </div>
                    </AppCard>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activePanel === 'health' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <RuntimeHealthPanel />
              <AppCard className="mt-4 p-4">
                <div className="mb-2 text-sm font-bold text-stone-800">发布检查</div>
                <div className="space-y-2 text-xs text-stone-500">
                  <div className="flex items-center justify-between">
                    <span>统一任务入口</span>
                    <span className="font-semibold text-emerald-700">已启用</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>历史记录</span>
                    <span className="font-semibold text-emerald-700">本地保存最近 30 次</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>报告导出</span>
                    <span className="font-semibold text-emerald-700">JSON / CSV</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>备份还原</span>
                    <span className="font-semibold text-emerald-700">批量支持</span>
                  </div>
                </div>
              </AppCard>
            </div>
          )}
        </AppPanel>
      </div>

      <AppCard className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-xs text-stone-500">
        <span>TinyPNG Key：{validKeys.length} 个已配置 · 目录会在后端按类型扫描</span>
        <div className="flex flex-wrap gap-2">
          <AppButton
            type="button"
            onClick={() => navigate('/settings?tab=image')}
            variant="ghost"
            className="px-3 py-1.5 text-xs"
          >
            管理 Key
          </AppButton>
          <AppButton
            type="button"
            onClick={() => setActivePanel('health')}
            variant="ghost"
            className="px-3 py-1.5 text-xs"
          >
            检查 ffmpeg
          </AppButton>
          <AppButton
            type="button"
            onClick={() => navigate('/settings?tab=backup')}
            variant="ghost"
            className="px-3 py-1.5 text-xs"
          >
            打开备份设置
          </AppButton>
          <AppButton
            type="button"
            onClick={clearHistory}
            disabled={history.length === 0}
            variant="ghost"
            className="px-3 py-1.5 text-xs"
          >
            清理历史
          </AppButton>
        </div>
      </AppCard>
    </div>
  )
}
