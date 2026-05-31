/**
 * @file ComparePanel.jsx
 * @description 压缩前后对比面板，支持图片、音频、备份状态、排序与还原。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch'
import { convertFileSrc } from '@tauri-apps/api/core'
import { basename, formatTimestamp, isAudio, isImage } from '../utils/fileUtils'
import {
  deleteBackupFile,
  getBackupStatus,
  getFileMetadata,
  openInFinder,
  restoreFile
} from '../api/desktop'
import { useToast } from '../toast/useToast'
import ImageCompareSlider from './ImageCompareSlider'

function toLocalURL(filePath) {
  return filePath ? convertFileSrc(filePath) : ''
}

function LocalImage({ filePath, className, alt }) {
  if (!filePath) return null
  return <img src={toLocalURL(filePath)} className={className} alt={alt} />
}

LocalImage.propTypes = {
  filePath: PropTypes.string,
  className: PropTypes.string,
  alt: PropTypes.string
}

function LocalAudio({ filePath }) {
  if (!filePath) return null
  return <audio controls src={toLocalURL(filePath)} className="h-8 w-full" />
}

LocalAudio.propTypes = { filePath: PropTypes.string }

function SizeBar({ inputBytes, outputBytes }) {
  if (!inputBytes || !outputBytes || inputBytes === 0) return null
  const pct = Math.min(100, Math.round((outputBytes / inputBytes) * 100))
  const saved = (((inputBytes - outputBytes) / inputBytes) * 100).toFixed(1)
  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-sky-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-emerald-600">
        -{saved}%
      </span>
    </div>
  )
}

SizeBar.propTypes = {
  inputBytes: PropTypes.number,
  outputBytes: PropTypes.number
}

function ImageCompareModal({ item, onClose }) {
  const [mode, setMode] = useState('side')

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[900px] max-w-[92vw] flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
          <span
            className="max-w-md truncate font-mono text-sm font-semibold text-stone-700"
            title={item.file}
          >
            {basename(item.file)}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode(mode === 'side' ? 'slider' : 'side')}
              className="interactive-ghost rounded-2xl bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600"
            >
              {mode === 'side' ? '滑块对比' : '并排对比'}
            </button>
            <button
              onClick={onClose}
              className="interactive-ghost rounded-full px-2 text-xl leading-none text-stone-400"
            >
              ×
            </button>
          </div>
        </div>

        {mode === 'slider' ? (
          <div className="p-5">
            <ImageCompareSlider leftPath={item.backupPath} rightPath={item.file} height="h-[68vh]" />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden rounded-b-2xl">
            {[
              { label: '原始备份', file: item.backupPath, size: item.inputSize },
              { label: '压缩后', file: item.file, size: item.outputSize }
            ].map(({ label, file, size }) => (
              <div key={label} className="flex min-w-0 flex-col bg-stone-50 px-5 py-4">
                <div className="mb-3 text-center text-xs font-medium text-stone-500">{label}</div>
                <div className="min-h-0 flex-1">
                  <TransformWrapper>
                    <TransformComponent
                      wrapperClass="!w-full !h-full"
                      contentClass="!w-full !h-full flex items-center justify-center"
                    >
                      <LocalImage
                        filePath={file}
                        className="max-h-full max-w-full object-contain"
                        alt={label}
                      />
                    </TransformComponent>
                  </TransformWrapper>
                </div>
                <div className="mt-3 text-center text-xs font-medium tabular-nums text-stone-500">
                  {size}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

ImageCompareModal.propTypes = {
  item: PropTypes.object,
  onClose: PropTypes.func.isRequired
}

function MetadataGrid({ metadata }) {
  if (!metadata) return null
  const rows = [
    ['大小', metadata.size],
    ['修改时间', formatTimestamp(metadata.modified)],
    [
      '尺寸',
      metadata.image?.width && metadata.image?.height
        ? `${metadata.image.width} × ${metadata.image.height}`
        : null
    ],
    ['时长', metadata.audio?.duration],
    ['编码', metadata.audio?.codec],
    ['采样率', metadata.audio?.sampleRate],
    ['声道', metadata.audio?.channels],
    ['码率', metadata.audio?.bitrate]
  ].filter(([, value]) => value)

  if (rows.length === 0) return null

  return (
    <div className="mt-3 grid gap-2 text-[11px] text-stone-500 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <span key={label} className="truncate rounded-xl bg-white/70 px-2 py-1">
          {label}：<span className="font-medium text-stone-700">{value}</span>
        </span>
      ))}
    </div>
  )
}

MetadataGrid.propTypes = { metadata: PropTypes.object }

function ImageCompareView({ item, fullscreen = false }) {
  const [mode, setMode] = useState('side')
  const imageHeight = fullscreen ? 'h-[58vh]' : 'h-[46vh]'
  const imageMinHeight = fullscreen ? 'min-h-[58vh]' : 'min-h-[46vh]'

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs text-stone-500">
          {item.inputSize} → {item.outputSize}，节省{' '}
          <span className="font-semibold text-emerald-600">{item.saved}</span>
        </div>
        <button
          onClick={() => setMode(mode === 'side' ? 'slider' : 'side')}
          className="interactive-ghost rounded-2xl bg-white px-3 py-1.5 text-xs font-medium text-stone-600"
        >
          {mode === 'side' ? '切换滑块对比' : '切换并排对比'}
        </button>
      </div>
      {mode === 'slider' ? (
        <ImageCompareSlider leftPath={item.backupPath} rightPath={item.file} height={imageHeight} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {[
            { label: '原始备份', file: item.backupPath, size: item.inputSize },
            { label: '压缩后', file: item.file, size: item.outputSize }
          ].map(({ label, file, size }) => (
            <div
              key={label}
              className={`flex ${imageMinHeight} min-w-0 flex-col rounded-2xl border border-stone-200 bg-white p-3`}
            >
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-stone-600">{label}</span>
                <span className="tabular-nums text-stone-400">{size}</span>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-stone-50">
                <LocalImage
                  filePath={file}
                  className="max-h-full max-w-full object-contain"
                  alt={label}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

ImageCompareView.propTypes = {
  item: PropTypes.object.isRequired,
  fullscreen: PropTypes.bool
}

export default function ComparePanel({ logs, fullscreen = false }) {
  const toast = useToast()
  const [restoredSet, setRestoredSet] = useState(new Set())
  const [loadingSet, setLoadingSet] = useState(new Set())
  const [deletingSet, setDeletingSet] = useState(new Set())
  const [modalItem, setModalItem] = useState(null)
  const [sortBy, setSortBy] = useState('saved')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedFile, setSelectedFile] = useState('')
  const [details, setDetails] = useState({})

  const successItems = useMemo(
    () => logs.filter((item) => item.status === 'success' && item.backupPath),
    [logs]
  )

  useEffect(() => {
    let active = true
    const missing = successItems.filter((item) => !details[item.file])
    if (missing.length === 0) return undefined

    Promise.all(
      missing.map(async (item) => {
        const [backupStatus, originalMeta, currentMeta] = await Promise.all([
          getBackupStatus({ originalPath: item.file, backupPath: item.backupPath }),
          getFileMetadata(item.backupPath),
          getFileMetadata(item.file)
        ])
        return [item.file, { backupStatus, originalMeta, currentMeta }]
      })
    )
      .then((entries) => {
        if (!active) return
        setDetails((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
      })
      .catch((error) => console.error('[compare] failed to load metadata', error))

    return () => {
      active = false
    }
  }, [details, successItems])

  const items = useMemo(() => {
    const filtered = successItems.filter((item) => {
      if (typeFilter === 'image') return isImage(item.file)
      if (typeFilter === 'audio') return isAudio(item.file)
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return basename(a.file).localeCompare(basename(b.file), 'zh-CN')
      return b.inputBytes - b.outputBytes - (a.inputBytes - a.outputBytes)
    })
  }, [sortBy, successItems, typeFilter])

  useEffect(() => {
    if (items.length === 0) {
      setSelectedFile('')
      return
    }
    if (!items.some((item) => item.file === selectedFile)) {
      setSelectedFile(items[0].file)
    }
  }, [items, selectedFile])

  const selected = items.find((item) => item.file === selectedFile) ?? items[0]

  const copyPath = useCallback(
    async (path) => {
      try {
        await navigator.clipboard?.writeText(path)
        toast.success('路径已复制')
      } catch (error) {
        toast.error(`复制失败：${error?.message ?? error}`)
      }
    },
    [toast]
  )

  const openSelectedLocation = useCallback(
    async (path) => {
      try {
        await openInFinder(path)
        toast.info('已打开文件位置')
      } catch (error) {
        toast.error(`打开位置失败：${error?.message ?? error}`)
      }
    },
    [toast]
  )

  const restore = useCallback(
    async (item) => {
      if (loadingSet.has(item.file)) return
      const ok = window.confirm(`确认将备份还原到当前文件？\n${item.file}`)
      if (!ok) return
      setLoadingSet((set) => new Set([...set, item.file]))
      try {
        await restoreFile(item.backupPath, item.file)
        setRestoredSet((set) => new Set([...set, item.file]))
        const [backupStatus, currentMeta] = await Promise.all([
          getBackupStatus({ originalPath: item.file, backupPath: item.backupPath }),
          getFileMetadata(item.file)
        ])
        setDetails((prev) => ({
          ...prev,
          [item.file]: { ...prev[item.file], backupStatus, currentMeta }
        }))
        toast.success('已还原原始文件')
      } catch (error) {
        toast.error(`还原失败：${error?.message ?? error}`)
      } finally {
        setLoadingSet((set) => {
          const next = new Set(set)
          next.delete(item.file)
          return next
        })
      }
    },
    [loadingSet, toast]
  )

  const deleteBackup = useCallback(
    async (item) => {
      if (deletingSet.has(item.file) || loadingSet.has(item.file)) return
      const ok = window.confirm(`确认删除当前文件的备份？\n${item.backupPath}`)
      if (!ok) return
      setDeletingSet((set) => new Set([...set, item.file]))
      try {
        await deleteBackupFile(item.backupPath, item.file)
        const [backupStatus, originalMeta] = await Promise.all([
          getBackupStatus({ originalPath: item.file, backupPath: item.backupPath }),
          getFileMetadata(item.backupPath)
        ])
        setDetails((prev) => ({
          ...prev,
          [item.file]: { ...prev[item.file], backupStatus, originalMeta }
        }))
        toast.success('已删除备份文件')
      } catch (error) {
        toast.error(`删除备份失败：${error?.message ?? error}`)
      } finally {
        setDeletingSet((set) => {
          const next = new Set(set)
          next.delete(item.file)
          return next
        })
      }
    },
    [deletingSet, loadingSet, toast]
  )

  if (successItems.length === 0) {
    return <div className="py-10 text-center text-sm text-stone-400">没有可对比的文件</div>
  }

  const selectedDetails = selected ? details[selected.file] : null
  const backupStatus = selectedDetails?.backupStatus
  const backupExists = backupStatus?.backupExists !== false
  const isRestored = selected ? restoredSet.has(selected.file) : false
  const isLoading = selected ? loadingSet.has(selected.file) : false
  const isDeleting = selected ? deletingSet.has(selected.file) : false
  const selectedIsImage = selected ? isImage(selected.file) : false
  const selectedIsAudio = selected ? isAudio(selected.file) : false

  return (
    <div className={fullscreen ? 'flex h-full min-h-0 flex-col' : undefined}>
      {modalItem && <ImageCompareModal item={modalItem} onClose={() => setModalItem(null)} />}
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {[
            ['all', '全部'],
            ['image', '图片'],
            ['audio', '音频']
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTypeFilter(id)}
              className={`rounded-2xl px-3 py-1.5 text-xs ${typeFilter === id ? 'tab-active font-medium' : 'interactive-ghost text-stone-400'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[
            ['saved', '节省体积'],
            ['name', '文件名']
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSortBy(id)}
              className={`rounded-2xl px-3 py-1.5 text-xs ${sortBy === id ? 'tab-active font-medium' : 'interactive-ghost text-stone-400'}`}
            >
              按{label}排序
            </button>
          ))}
        </div>
      </div>

      <div
        className={`grid gap-4 ${
          fullscreen
            ? 'min-h-0 flex-1 overflow-hidden xl:grid-cols-[22rem_1fr]'
            : 'min-h-[58vh] xl:grid-cols-[18rem_1fr]'
        }`}
      >
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-100 bg-stone-50">
          <div className="shrink-0 border-b border-stone-100 px-3 py-2 text-xs font-semibold text-stone-500">
            成功记录 {items.length}
          </div>
          <div
            className={`${fullscreen ? 'min-h-0 flex-1 p-2 pb-8' : 'max-h-[58vh] p-2'} overflow-y-auto`}
          >
            {items.map((item) => {
              const active = selected?.file === item.file
              return (
                <button
                  key={item.file}
                  onClick={() => setSelectedFile(item.file)}
                  className={`interactive-row compare-record-item mb-1 w-full rounded-xl border px-3 py-2 text-left ${
                    active
                      ? 'choice-active'
                      : 'border-transparent hover:border-stone-200 hover:bg-white/70'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] font-black text-stone-400">
                      {item.format?.toUpperCase() ??
                        (isImage(item.file) ? 'IMG' : isAudio(item.file) ? 'AUD' : 'FILE')}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-stone-700">
                      {basename(item.file)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-stone-500">
                    <span>{item.outputSize}</span>
                    <span className="font-semibold text-emerald-600">-{item.saved}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        {selected && (
          <section
            className={`${fullscreen ? 'min-h-0 overflow-y-auto p-4 pb-12' : 'p-4'} min-w-0 rounded-2xl border border-stone-100 bg-stone-50`}
          >
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-500">
                    {selected.format?.toUpperCase() ??
                      (selectedIsImage ? 'IMG' : selectedIsAudio ? 'AUD' : 'FILE')}
                  </span>
                  <h3
                    className="truncate font-mono text-sm font-bold text-stone-800"
                    title={selected.file}
                  >
                    {basename(selected.file)}
                  </h3>
                </div>
                <div className="mt-1 text-xs text-stone-500">
                  {selected.inputSize} → {selected.outputSize}，节省{' '}
                  <span className="font-semibold text-emerald-600">{selected.saved}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => copyPath(selected.file)}
                  className="interactive-ghost rounded-2xl bg-white px-3 py-1.5 text-xs text-stone-500"
                >
                  复制路径
                </button>
                <button
                  onClick={() => openSelectedLocation(selected.file)}
                  className="interactive-ghost rounded-2xl bg-white px-3 py-1.5 text-xs text-stone-500"
                >
                  打开位置
                </button>
                {selectedIsImage && (
                  <button
                    onClick={() => setModalItem(selected)}
                    className="interactive-ghost rounded-2xl bg-white px-3 py-1.5 text-xs text-stone-500"
                  >
                    放大
                  </button>
                )}
                <button
                  onClick={() => restore(selected)}
                  disabled={isRestored || isLoading || isDeleting || !backupExists}
                  className={`rounded-2xl px-3 py-1.5 text-xs font-medium ${
                    isRestored
                      ? 'bg-stone-100 text-stone-400'
                      : backupExists
                        ? 'interactive-danger bg-red-50 text-red-500'
                        : 'bg-stone-100 text-stone-400'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isLoading
                    ? '还原中'
                    : isRestored
                      ? '已还原'
                      : backupExists
                        ? '还原'
                        : '备份缺失'}
                </button>
                <button
                  onClick={() => deleteBackup(selected)}
                  disabled={isLoading || isDeleting || !backupExists}
                  className={`rounded-2xl px-3 py-1.5 text-xs font-medium ${
                    backupExists
                      ? 'interactive-danger bg-red-50 text-red-500'
                      : 'bg-stone-100 text-stone-400'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {isDeleting ? '删除中' : backupExists ? '删除备份' : '备份缺失'}
                </button>
              </div>
            </div>

            {selectedIsImage && <ImageCompareView item={selected} fullscreen={fullscreen} />}

            {selectedIsAudio && (
              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
                <div>
                  <div className="mb-1 text-center text-xs text-stone-400">原始备份</div>
                  <div className="rounded-2xl border border-stone-200 bg-white px-3 py-2">
                    <LocalAudio filePath={selected.backupPath} />
                  </div>
                </div>
                <div className="flex items-center justify-center text-stone-300">→</div>
                <div>
                  <div className="mb-1 text-center text-xs text-emerald-700">压缩后</div>
                  <div className="rounded-2xl border border-sky-200 bg-white px-3 py-2">
                    <LocalAudio filePath={selected.file} />
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <MetadataGrid metadata={selectedDetails?.originalMeta} />
              <MetadataGrid metadata={selectedDetails?.currentMeta} />
            </div>
            <SizeBar inputBytes={selected.inputBytes} outputBytes={selected.outputBytes} />
            {backupStatus && (
              <div className="mt-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-stone-500">
                备份：{backupStatus.backupExists ? backupStatus.backupSize : '缺失'} · 当前：
                {backupStatus.originalExists ? backupStatus.originalSize : '缺失'} ·{' '}
                {formatTimestamp(backupStatus.backupModified)}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

ComparePanel.propTypes = {
  logs: PropTypes.arrayOf(
    PropTypes.shape({
      status: PropTypes.string,
      file: PropTypes.string,
      backupPath: PropTypes.string,
      format: PropTypes.string,
      inputBytes: PropTypes.number,
      outputBytes: PropTypes.number,
      inputSize: PropTypes.string,
      outputSize: PropTypes.string,
      saved: PropTypes.string,
      error: PropTypes.string
    })
  ).isRequired,
  fullscreen: PropTypes.bool
}
