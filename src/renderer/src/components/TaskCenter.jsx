import { useEffect, useMemo, useRef, useState } from 'react'
import ComparePanel from './ComparePanel'
import { AppButton, AppCard, AppInput, AppPanel, AppSelect, AppTabs, EmptyState } from './ui/base'
import {
  compressAudio, compressImage, onAudioDone, onAudioPaused, onAudioProgress, onAudioTotal,
  onImageDone, onImageKeyCount, onImagePaused, onImageProgress, onImageTotal, openDirectories,
  openFiles, stopAudioCompression, stopImageCompression
} from '../api/desktop'
import { useSettings } from '../settings/useSettings'
import { PRESET_IDS, PRESET_META, getPreset } from '../tasks/taskPresets'
import {
  clearTaskRecords, createTaskRecord, deleteTaskRecord, finishTaskRecord, loadTaskRecords,
  upsertTaskRecord
} from '../tasks/taskHistory'
import { getValidTinypngKeyValues, useTinypngKeys } from '../tinypng/useTinypngKeys'
import { useToast } from '../toast/useToast'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg']
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav']
const REPORT_COLUMNS = ['kind', 'status', 'file', 'backupPath', 'inputSize', 'outputSize', 'saved', 'reason', 'error']

function getExtension(path) {
  const parts = (path.split(/[\\/]/).pop() ?? '').split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

function groupPaths(paths) {
  return paths.reduce((result, path) => {
    const ext = getExtension(path)
    if (IMAGE_EXTENSIONS.includes(ext)) result.image.push(path)
    else if (AUDIO_EXTENSIONS.includes(ext)) result.audio.push(path)
    else result.directory.push(path)
    return result
  }, { image: [], audio: [], directory: [] })
}

function sumStats(image, audio) {
  return {
    total: (image?.total ?? 0) + (audio?.total ?? 0),
    processed: (image?.processed ?? 0) + (audio?.processed ?? 0),
    skipped: (image?.skipped ?? 0) + (audio?.skipped ?? 0),
    failed: (image?.failed ?? 0) + (audio?.failed ?? 0)
  }
}

function downloadText(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function buildCsv(logs) {
  const escape = (value) => {
    const text = value == null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [REPORT_COLUMNS.join(','), ...logs.map((item) => REPORT_COLUMNS.map((key) => escape(item[key])).join(','))].join('\n')
}

export default function TaskCenter() {
  const toast = useToast()
  const { settings } = useSettings()
  const { keys, setKeys } = useTinypngKeys()
  const [paths, setPaths] = useState([])
  const [presetId, setPresetId] = useState(settings.defaultPresetId)
  const preset = getPreset(settings, presetId)
  const [records, setRecords] = useState(() => loadTaskRecords())
  const [selectedId, setSelectedId] = useState(() => loadTaskRecords()[0]?.id ?? null)
  const [activePanel, setActivePanel] = useState('records')
  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [currentKind, setCurrentKind] = useState(null)
  const recordRef = useRef(null)
  const validKeys = useMemo(() => getValidTinypngKeyValues(keys), [keys])
  const selected = records.find((item) => item.id === selectedId) ?? records[0] ?? null

  useEffect(() => {
    const sync = (event) => setRecords(event.detail)
    window.addEventListener('tinypress:task-records', sync)
    return () => window.removeEventListener('tinypress:task-records', sync)
  }, [])

  const appendLog = (kind, item) => {
    if (!recordRef.current) return
    const next = { ...recordRef.current, logs: [...recordRef.current.logs, { ...item, kind }] }
    recordRef.current = next
    setRecords(upsertTaskRecord(next))
  }

  const runImage = (targets) => new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => { cleanTotal(); cleanProgress(); cleanKeyCount(); cleanDone(); cleanPaused() }
    const cleanTotal = onImageTotal(() => {})
    const cleanProgress = onImageProgress((item) => appendLog('image', item))
    const cleanKeyCount = onImageKeyCount(({ key, compressionCount }) => setKeys((items) => items.map((item) => item.value.trim() === key ? { ...item, compressionCount } : item)))
    const cleanDone = onImageDone((stats) => { if (!settled) { settled = true; cleanup(); resolve(stats) } })
    const cleanPaused = onImagePaused(() => { if (!settled) { settled = true; cleanup(); resolve(null) } })
    compressImage({ paths: targets, apiKeys: validKeys, recursive: preset.recursiveScan }).catch((error) => { if (!settled) { settled = true; cleanup(); reject(error) } })
  })

  const runAudio = (targets) => new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => { cleanTotal(); cleanProgress(); cleanDone(); cleanPaused() }
    const cleanTotal = onAudioTotal(() => {})
    const cleanProgress = onAudioProgress((item) => appendLog('audio', item))
    const cleanDone = onAudioDone((stats) => { if (!settled) { settled = true; cleanup(); resolve(stats) } })
    const cleanPaused = onAudioPaused(() => { if (!settled) { settled = true; cleanup(); resolve(null) } })
    compressAudio({ paths: targets, format: preset.audioFormat, quality: preset.audioQuality, recursive: preset.recursiveScan }).catch((error) => { if (!settled) { settled = true; cleanup(); reject(error) } })
  })

  const startBatch = async (overridePaths = paths) => {
    if (overridePaths.length === 0) return toast.warning('请先添加文件或目录')
    const targets = groupPaths(overridePaths)
    if ((targets.image.length > 0 || targets.directory.length > 0) && validKeys.length === 0) return toast.warning('图片压缩需要先填写 TinyPNG API Key')
    const record = createTaskRecord({ source: 'task-center', presetId: preset.id, presetSnapshot: preset, inputCount: overridePaths.length })
    recordRef.current = record
    setRecords(upsertTaskRecord(record))
    setSelectedId(record.id)
    setRunning(true)
    let imageStats = null
    let audioStats = null
    try {
      if (targets.image.length || targets.directory.length) {
        setCurrentKind('image')
        imageStats = await runImage([...targets.image, ...targets.directory])
        if (!imageStats) return finish('paused', sumStats(null, null))
      }
      if (targets.audio.length || targets.directory.length) {
        setCurrentKind('audio')
        audioStats = await runAudio([...targets.audio, ...targets.directory])
        if (!audioStats) return finish('paused', sumStats(imageStats, null))
      }
      const stats = sumStats(imageStats, audioStats)
      finish(stats.failed > 0 ? 'error' : 'success', stats)
      toast.success(`任务完成：成功 ${stats.processed}，失败 ${stats.failed}，跳过 ${stats.skipped}`)
    } catch (error) {
      appendLog(currentKind ?? 'task', { status: 'error', file: overridePaths[0] ?? 'TinyPress 任务', error: error?.message ?? String(error) })
      finish('error', recordRef.current.stats)
      toast.error(`任务失败：${error?.message ?? error}`)
    } finally {
      setRunning(false)
      setCurrentKind(null)
    }
  }

  const finish = (status, stats) => {
    if (!recordRef.current) return
    const next = finishTaskRecord(recordRef.current, status, stats, recordRef.current.logs)
    recordRef.current = next
    setRecords(upsertTaskRecord(next))
  }

  const addFiles = async () => {
    const files = await openFiles({ filters: [{ name: 'TinyPress 支持文件', extensions: [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS] }] })
    if (files.length) setPaths((items) => [...new Set([...items, ...files])])
  }
  const addDirectories = async () => {
    const dirs = await openDirectories()
    if (dirs.length) setPaths((items) => [...new Set([...items, ...dirs])])
  }
  const filtered = records.filter((record) => !query.trim() || record.logs.some((log) => log.file?.toLowerCase().includes(query.trim().toLowerCase())))
  const exportRecord = (format) => {
    if (!selected) return
    const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
    downloadText(`tinypress-record-${stamp}.${format}`, format === 'csv' ? buildCsv(selected.logs) : JSON.stringify(selected, null, 2), format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8')
  }

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-5 md:px-7 md:py-6">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(320px,0.92fr)_minmax(360px,1.08fr)] lg:overflow-hidden">
        <AppPanel className="flex min-h-0 flex-col overflow-hidden p-5">
          <h3 className="text-sm font-bold text-stone-800">任务中心</h3>
          <p className="mt-1 text-xs text-stone-500">统一加入文件，按类型自动分派图片与音频压缩。</p>
          <label className="mt-4 text-xs font-bold text-stone-600">本次预设
            <AppSelect value={preset.id} onChange={(event) => setPresetId(event.target.value)} disabled={running} className="ml-2 py-1.5 text-xs" aria-label="本次预设">
              {PRESET_IDS.map((id) => <option key={id} value={id}>{PRESET_META[id].label}</option>)}
            </AppSelect>
          </label>
          <div className="my-4 flex flex-wrap gap-2">
            <AppButton onClick={addFiles} disabled={running} variant="secondary" className="px-3 py-1.5 text-xs">+ 添加文件</AppButton>
            <AppButton onClick={addDirectories} disabled={running} variant="secondary" className="px-3 py-1.5 text-xs">+ 添加目录</AppButton>
          </div>
          {paths.length === 0 ? <EmptyState className="flex flex-1 items-center justify-center">添加 PNG、JPG、MP3、OGG、WAV 文件或目录</EmptyState> : (
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {paths.map((path) => <AppCard key={path} as="li" className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span><button onClick={() => setPaths((items) => items.filter((item) => item !== path))}>x</button></AppCard>)}
            </ul>
          )}
          {running ? <AppButton onClick={() => currentKind === 'image' ? stopImageCompression() : stopAudioCompression()} variant="danger" className="mt-4 py-2.5">暂停当前任务</AppButton> : <AppButton onClick={() => startBatch()} variant="primary" className="mt-4 py-2.5">开始统一处理</AppButton>}
        </AppPanel>
        <AppPanel className="flex min-h-0 flex-col overflow-hidden">
          <AppTabs value={activePanel} onChange={setActivePanel} items={[{ id: 'records', label: '任务记录' }, { id: 'compare', label: '结果对比' }]} className="border-b border-stone-100 p-2" />
          {activePanel === 'records' && <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <AppInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索路径" className="min-w-0 flex-1 py-1 text-xs" />
              <AppButton onClick={() => exportRecord('json')} disabled={!selected} variant="secondary" className="px-2 py-1 text-xs">导出 JSON</AppButton>
              <AppButton onClick={() => exportRecord('csv')} disabled={!selected} variant="secondary" className="px-2 py-1 text-xs">导出 CSV</AppButton>
              <AppButton onClick={() => setRecords(clearTaskRecords())} disabled={!records.length} variant="danger" className="px-2 py-1 text-xs">清空全部</AppButton>
            </div>
            {filtered.length === 0 ? <EmptyState>暂无任务记录</EmptyState> : <ul className="space-y-2">{filtered.map((record) => <AppCard key={record.id} as="li" active={record.id === selected?.id} className="p-3"><button className="w-full text-left" onClick={() => setSelectedId(record.id)}><span className="block text-sm font-bold">{PRESET_META[record.presetId]?.label ?? '任务'} · {record.status}</span><span className="mt-1 block text-xs text-stone-500">输入 {record.inputCount}，成功 {record.stats.processed}，失败 {record.stats.failed}</span></button><div className="mt-2 flex gap-2"><AppButton onClick={() => { setSelectedId(record.id); setActivePanel('compare') }} variant="secondary" className="px-2 py-1 text-xs">查看结果</AppButton><AppButton onClick={() => startBatch(record.logs.filter((log) => log.status === 'error').map((log) => log.file))} disabled={!record.logs.some((log) => log.status === 'error')} variant="secondary" className="px-2 py-1 text-xs">重试失败</AppButton><AppButton onClick={() => setRecords(deleteTaskRecord(record.id))} variant="danger" className="px-2 py-1 text-xs">删除</AppButton></div></AppCard>)}</ul>}
          </div>}
          {activePanel === 'compare' && <div className="min-h-0 flex-1 overflow-y-auto p-4">{selected?.logs.some((log) => log.status === 'success') ? <ComparePanel logs={selected.logs.filter((log) => log.status === 'success')} /> : <EmptyState>选择包含成功结果的任务记录后查看对比</EmptyState>}</div>}
        </AppPanel>
      </div>
    </div>
  )
}
