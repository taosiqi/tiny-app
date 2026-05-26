/**
 * @file FileCompare.jsx
 * @description 独立文件对比页面，支持图片、音频、文本和二进制文件。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { convertFileSrc } from '@tauri-apps/api/core'
import { compareFiles, openFiles, openInFinder } from '../api/desktop'
import { basename, formatTimestamp } from '../utils/fileUtils'
import { useToast } from '../toast/useToast'

function toLocalURL(filePath) {
  return filePath ? convertFileSrc(filePath) : ''
}

function pickText(result) {
  if (!result) return '选择文件后开始对比'
  if (result.sameHash === true) return '两个文件完全一致'
  if (result.sameHash === false) return '两个文件存在差异'
  return '无法判断文件是否一致'
}

function FilePicker({ label, path, onPick, onClear }) {
  return (
    <section className="rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-stone-700">{label}</span>
        <div className="flex gap-2">
          <button
            onClick={onPick}
            className="interactive-button rounded-2xl bg-sky-100 px-3 py-1.5 text-xs text-stone-950"
          >
            选择文件
          </button>
          {path && (
            <button
              onClick={onClear}
              className="interactive-danger rounded-2xl border border-stone-200 px-3 py-1.5 text-xs text-stone-500"
            >
              清空
            </button>
          )}
        </div>
      </div>
      {path ? (
        <div className="truncate rounded-2xl bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700" title={path}>
          {path}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-200 py-7 text-center text-sm text-stone-400">
          尚未选择文件
        </div>
      )}
    </section>
  )
}

FilePicker.propTypes = {
  label: PropTypes.string.isRequired,
  path: PropTypes.string,
  onPick: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired
}

function MetadataCard({ title, meta }) {
  const toast = useToast()
  if (!meta) return null

  const openLocation = async () => {
    try {
      await openInFinder(meta.path)
      toast.info('已打开文件位置')
    } catch (error) {
      toast.error(`打开位置失败：${error?.message ?? error}`)
    }
  }

  const rows = [
    ['名称', meta.name],
    ['类型', meta.kind],
    ['大小', meta.size],
    ['修改时间', formatTimestamp(meta.modified)],
    ['尺寸', meta.image?.width && meta.image?.height ? `${meta.image.width} × ${meta.image.height}` : null],
    ['时长', meta.audio?.duration],
    ['编码', meta.audio?.codec],
    ['采样率', meta.audio?.sampleRate],
    ['声道', meta.audio?.channels],
    ['码率', meta.audio?.bitrate],
    ['SHA-256', meta.sha256]
  ].filter(([, value]) => value)

  return (
    <section className="rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="truncate text-sm font-bold text-stone-800">{title}</h3>
        <button onClick={openLocation} className="interactive-link shrink-0 rounded-full px-2 py-1 text-xs text-stone-400">
          打开位置
        </button>
      </div>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[4.5rem_1fr] gap-2 text-xs">
            <span className="text-stone-400">{label}</span>
            <span className="truncate font-medium text-stone-700" title={String(value)}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

MetadataCard.propTypes = {
  title: PropTypes.string.isRequired,
  meta: PropTypes.object
}

function ImagePreview({ result }) {
  const [position, setPosition] = useState(50)
  if (result.left.kind !== 'image' || result.right.kind !== 'image') return null

  return (
    <section className="rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-stone-800">图片对比</h3>
        <span className="text-xs text-stone-400">拖动滑块查看左右文件</span>
      </div>
      <div className="relative h-80 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <img src={toLocalURL(result.right.path)} alt="right" className="h-full w-full object-contain" />
        <div className="absolute inset-y-0 left-0 overflow-hidden bg-white" style={{ width: `${position}%` }}>
          <div className="h-full" style={{ width: `${10000 / Math.max(position, 1)}%` }}>
            <img src={toLocalURL(result.left.path)} alt="left" className="h-full w-full object-contain" />
          </div>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          className="absolute inset-x-6 bottom-4 accent-[var(--theme-accent)]"
          aria-label="图片对比滑块"
        />
      </div>
    </section>
  )
}

ImagePreview.propTypes = { result: PropTypes.object.isRequired }

function AudioPreview({ result }) {
  if (result.left.kind !== 'audio' || result.right.kind !== 'audio') return null

  return (
    <section className="rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
      <h3 className="mb-3 text-sm font-bold text-stone-800">音频对比</h3>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-2xl border border-stone-200 bg-white px-3 py-2">
          <div className="mb-2 truncate text-center text-xs text-stone-400">{basename(result.left.path)}</div>
          <audio controls src={toLocalURL(result.left.path)} className="h-8 w-full" />
        </div>
        <div className="flex items-center justify-center text-stone-300">→</div>
        <div className="rounded-2xl border border-sky-200 bg-white px-3 py-2">
          <div className="mb-2 truncate text-center text-xs text-emerald-700">{basename(result.right.path)}</div>
          <audio controls src={toLocalURL(result.right.path)} className="h-8 w-full" />
        </div>
      </div>
    </section>
  )
}

AudioPreview.propTypes = { result: PropTypes.object.isRequired }

function TextDiff({ result }) {
  const toast = useToast()
  if (!result.textDiff) return null
  const changed = result.textDiff.filter((line) => line.kind !== 'same')
  const copyDiff = async () => {
    try {
      await navigator.clipboard?.writeText(changed.map((line) => `${line.line}: ${line.left ?? ''} -> ${line.right ?? ''}`).join('\n'))
      toast.success('差异内容已复制')
    } catch (error) {
      toast.error(`复制差异失败：${error?.message ?? error}`)
    }
  }

  return (
    <section className="rounded-3xl border border-white/70 bg-white/72 p-5 shadow-sm shadow-stone-900/5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-stone-800">文本差异</h3>
        <button
          onClick={copyDiff}
          className="interactive-link rounded-full px-2 py-1 text-xs text-stone-400"
        >
          复制差异
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-2xl border border-stone-100 bg-stone-50 font-mono text-xs">
        {(changed.length > 0 ? changed : result.textDiff.slice(0, 80)).map((line) => (
          <div
            key={`${line.line}-${line.kind}`}
            className={`grid grid-cols-[3rem_1fr_1fr] gap-3 border-b border-white/70 px-3 py-1.5 ${
              line.kind === 'same'
                ? 'text-stone-400'
                : line.kind === 'added'
                  ? 'bg-emerald-50 text-emerald-800'
                  : line.kind === 'removed'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-yellow-100/70 text-stone-800'
            }`}
          >
            <span className="text-stone-400">{line.line}</span>
            <span className="truncate" title={line.left ?? ''}>
              {line.left ?? ''}
            </span>
            <span className="truncate" title={line.right ?? ''}>
              {line.right ?? ''}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

TextDiff.propTypes = { result: PropTypes.object.isRequired }

export default function FileCompare() {
  const toast = useToast()
  const [leftPath, setLeftPath] = useState('')
  const [rightPath, setRightPath] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const clearAll = () => {
    setLeftPath('')
    setRightPath('')
    setResult(null)
    setError('')
    setLoading(false)
    toast.info('已清除全部对比内容')
  }

  const pickFile = async (side) => {
    const files = await openFiles()
    const file = files[0]
    if (!file) return
    if (side === 'left') setLeftPath(file)
    else setRightPath(file)
    toast.info(`已选择文件 ${side === 'left' ? 'A' : 'B'}`)
  }

  const runCompare = useCallback(async () => {
    if (!leftPath || !rightPath) {
      setResult(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      setResult(await compareFiles(leftPath, rightPath))
    } catch (nextError) {
      const message = nextError?.message ?? String(nextError)
      setError(message)
      setResult(null)
      toast.error(`文件对比失败：${message}`)
    } finally {
      setLoading(false)
    }
  }, [leftPath, rightPath, toast])

  useEffect(() => {
    runCompare()
  }, [runCompare])

  const sizeDelta = useMemo(() => {
    if (!result?.sizeDelta) return '0 B'
    const abs = Math.abs(result.sizeDelta)
    const sign = result.sizeDelta > 0 ? '+' : '-'
    if (abs < 1024) return `${sign}${abs} B`
    return `${sign}${(abs / 1024).toFixed(2)} KB`
  }, [result])

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-2">
          <FilePicker
            label="文件 A"
            path={leftPath}
            onPick={() => pickFile('left')}
            onClear={() => {
              setLeftPath('')
              toast.info('已清空文件 A')
            }}
          />
          <FilePicker
            label="文件 B"
            path={rightPath}
            onPick={() => pickFile('right')}
            onClear={() => {
              setRightPath('')
              toast.info('已清空文件 B')
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setLeftPath(rightPath)
              setRightPath(leftPath)
              toast.info('已交换左右文件')
            }}
            disabled={!leftPath && !rightPath}
            className="interactive-button rounded-2xl bg-sky-100 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-40"
          >
            交换左右文件
          </button>
          <button
            onClick={clearAll}
            disabled={!leftPath && !rightPath && !result && !error}
            className="interactive-danger rounded-2xl border border-stone-200 px-4 py-2 text-sm font-semibold text-stone-500 disabled:opacity-60"
          >
            清除全部
          </button>
          <span className="text-sm text-stone-500">{loading ? '正在对比...' : pickText(result)}</span>
          {result && <span className="text-sm text-stone-400">大小差异：{sizeDelta}</span>}
          {error && <span className="text-sm text-red-500">{error}</span>}
        </div>

        {result && (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <MetadataCard title="文件 A 信息" meta={result.left} />
              <MetadataCard title="文件 B 信息" meta={result.right} />
            </div>
            <ImagePreview result={result} />
            <AudioPreview result={result} />
            <TextDiff result={result} />
            {result.left.kind === 'binary' || result.right.kind === 'binary' ? (
              <section className="rounded-3xl border border-white/70 bg-white/72 p-5 text-sm text-stone-600 shadow-sm shadow-stone-900/5">
                二进制判断：{result.sameHash ? 'SHA-256 一致，文件内容相同。' : 'SHA-256 不一致，文件内容不同。'}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
