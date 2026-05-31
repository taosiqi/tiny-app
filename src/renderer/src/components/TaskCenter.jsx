import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ComparePanel from './ComparePanel'
import { AppButton, AppCard, AppInput, AppPanel, AppTabs, EmptyState } from './ui/base'
import { PageHeader, PageLayout } from './ui/page'
import { clearTaskRecords, deleteTaskRecord, loadTaskRecords } from '../tasks/taskHistory'
import { useToast } from '../toast/useToast'

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif']
const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav']
const REPORT_COLUMNS = ['kind', 'status', 'file', 'backupPath', 'inputSize', 'outputSize', 'saved', 'reason', 'error']

function getExtension(path = '') {
  const parts = (path.split(/[\\/]/).pop() ?? '').split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

function retryPaths(record, type) {
  return [...new Set(record.logs
    .filter((log) => log.status === 'error' && (log.kind === type || (type === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS).includes(getExtension(log.file))))
    .map((log) => log.file)
    .filter(Boolean))]
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
  const navigate = useNavigate()
  const [records, setRecords] = useState(() => loadTaskRecords())
  const [selectedId, setSelectedId] = useState(() => loadTaskRecords()[0]?.id ?? null)
  const [activePanel, setActivePanel] = useState('records')
  const [query, setQuery] = useState('')
  const retryCounterRef = useRef(0)
  const selected = records.find((item) => item.id === selectedId) ?? records[0] ?? null

  useEffect(() => {
    const sync = (event) => setRecords(event.detail)
    window.addEventListener('tinypress:task-records', sync)
    return () => window.removeEventListener('tinypress:task-records', sync)
  }, [])

  const filtered = records.filter((record) => !query.trim() || record.logs.some((log) => log.file?.toLowerCase().includes(query.trim().toLowerCase())))

  const exportRecord = (format) => {
    if (!selected) return
    const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
    const filename = `tinypress-record-${stamp}.${format}`
    try {
      downloadText(filename, format === 'csv' ? buildCsv(selected.logs) : JSON.stringify(selected, null, 2), format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8')
      toast.success(`已导出 ${filename}`)
    } catch (error) {
      toast.error(`导出失败：${error?.message ?? error}`)
    }
  }

  const navigateRetry = (record, type) => {
    const paths = retryPaths(record, type)
    if (!paths.length) return
    retryCounterRef.current += 1
    navigate(type === 'image' ? '/png' : '/audio', {
      state: { retryPaths: paths, retryToken: `${record.id}-${type}-${retryCounterRef.current}` }
    })
  }

  return (
    <PageLayout>
      <PageHeader title="任务中心" description="查看压缩记录、导出报告和对比处理结果。" />
      <AppPanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AppTabs value={activePanel} onChange={setActivePanel} items={[{ id: 'records', label: '任务记录' }, { id: 'compare', label: '结果对比' }]} className="border-b border-stone-100 p-2" />
        {activePanel === 'records' && <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <AppInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索路径" className="min-w-0 flex-1 py-1 text-xs" />
            <AppButton onClick={() => exportRecord('json')} disabled={!selected} variant="secondary" className="px-2 py-1 text-xs">导出 JSON</AppButton>
            <AppButton onClick={() => exportRecord('csv')} disabled={!selected} variant="secondary" className="px-2 py-1 text-xs">导出 CSV</AppButton>
            <AppButton onClick={() => setRecords(clearTaskRecords())} disabled={!records.length} variant="danger" className="px-2 py-1 text-xs">清空全部</AppButton>
          </div>
          {filtered.length === 0 ? <EmptyState>暂无任务记录</EmptyState> : <ul className="space-y-2">{filtered.map((record) => {
            const imageRetries = retryPaths(record, 'image')
            const audioRetries = retryPaths(record, 'audio')
            return <AppCard key={record.id} as="li" active={record.id === selected?.id} className="p-3">
              <button className="w-full text-left" onClick={() => setSelectedId(record.id)}><span className="block text-sm font-bold">压缩任务 · {record.status}</span><span className="mt-1 block text-xs text-stone-500">输入 {record.inputCount}，成功 {record.stats.processed}，失败 {record.stats.failed}</span></button>
              <div className="mt-2 flex flex-wrap gap-2">
                <AppButton onClick={() => { setSelectedId(record.id); setActivePanel('compare') }} variant="secondary" className="px-2 py-1 text-xs">查看结果</AppButton>
                {imageRetries.length > 0 && <AppButton onClick={() => navigateRetry(record, 'image')} variant="secondary" className="px-2 py-1 text-xs">重试图片 ({imageRetries.length})</AppButton>}
                {audioRetries.length > 0 && <AppButton onClick={() => navigateRetry(record, 'audio')} variant="secondary" className="px-2 py-1 text-xs">重试音频 ({audioRetries.length})</AppButton>}
                <AppButton onClick={() => setRecords(deleteTaskRecord(record.id))} variant="danger" className="px-2 py-1 text-xs">删除</AppButton>
              </div>
            </AppCard>
          })}</ul>}
        </div>}
        {activePanel === 'compare' && <div className="min-h-0 flex-1 overflow-y-auto p-4">{selected?.logs.some((log) => log.status === 'success') ? <ComparePanel logs={selected.logs.filter((log) => log.status === 'success')} /> : <EmptyState>选择包含成功结果的任务记录后查看对比</EmptyState>}</div>}
      </AppPanel>
    </PageLayout>
  )
}
