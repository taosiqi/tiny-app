/**
 * @file ComparePanel.jsx
 * @description 压缩前后对比面板
 *
 * 展示每个成功压缩文件的原始备份与压缩后文件的大小对比。
 * 图片类文件额外展示缩略图。支持一键还原至备份版本。
 * 点击缩略图可弹窗全屏对比。
 */
import { useState, useCallback, useEffect } from 'react'
import PropTypes from 'prop-types'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { convertFileSrc } from '@tauri-apps/api/core'
import { basename, isImage } from '../utils/fileUtils'
import { openInFinder, restoreFile } from '../api/desktop'

/** 将本地绝对路径转为 Tauri asset URL（兼容 Mac/Windows） */
function toLocalURL(filePath) {
  if (!filePath) return ''
  return convertFileSrc(filePath)
}

/** 本地图片展示 */
function LocalImage({ filePath, className, alt }) {
  if (!filePath) return null
  return <img src={toLocalURL(filePath)} className={className} alt={alt} />
}
LocalImage.propTypes = {
  filePath: PropTypes.string,
  className: PropTypes.string,
  alt: PropTypes.string
}

/** 本地音频播放器：Tauri asset 协议，支持 seek */
function LocalAudio({ filePath }) {
  if (!filePath) return null
  return (
    <audio controls src={toLocalURL(filePath)} className="w-full h-8" style={{ outline: 'none' }} />
  )
}
LocalAudio.propTypes = {
  filePath: PropTypes.string
}

/**
 * 大小进度条：蓝色填充区域表示压缩后的相对大小 */
SizeBar.propTypes = {
  inputBytes: PropTypes.number,
  outputBytes: PropTypes.number
}
function SizeBar({ inputBytes, outputBytes }) {
  if (!inputBytes || !outputBytes || inputBytes === 0) return null
  const pct = Math.round((outputBytes / inputBytes) * 100)
  const saved = (((inputBytes - outputBytes) / inputBytes) * 100).toFixed(1)
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-lime-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-emerald-600 w-12 text-right shrink-0 tabular-nums">
        -{saved}%
      </span>
    </div>
  )
}

/**
 * 图片对比弹窗
 */
ImageCompareModal.propTypes = {
  item: PropTypes.shape({
    file: PropTypes.string,
    backupPath: PropTypes.string,
    inputSize: PropTypes.string,
    outputSize: PropTypes.string,
    saved: PropTypes.string
  }),
  onClose: PropTypes.func.isRequired
}
function ImageCompareModal({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!item) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ maxWidth: '90vw', maxHeight: '90vh', width: '860px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <span
            className="text-sm font-semibold text-stone-700 font-mono truncate max-w-xs"
            title={item.file}
          >
            🖼 {basename(item.file)}
          </span>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-xl leading-none ml-4 transition-colors"
            title="关闭"
          >
            ×
          </button>
        </div>

        {/* 图片对比区域 */}
        <div className="flex gap-0 flex-1 min-h-0 overflow-hidden rounded-b-2xl">
          {/* 原始 */}
          <div className="flex-1 flex flex-col items-center bg-stone-50 px-6 py-5 min-w-0 overflow-hidden">
            <div className="text-xs font-medium text-stone-500 mb-3">原始备份</div>
            <div
              className="flex-1 w-full flex items-center justify-center min-h-0 overflow-hidden"
              style={{ maxHeight: 'calc(90vh - 160px)' }}
            >
              <TransformWrapper>
                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full flex items-center justify-center"
                >
                  <img
                    src={toLocalURL(item.backupPath)}
                    alt="original"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </TransformComponent>
              </TransformWrapper>
            </div>
            <div className="text-xs text-stone-500 mt-3 tabular-nums font-medium">
              {item.inputSize}
            </div>
          </div>

          {/* 分隔线 + 箭头 */}
          <div className="flex flex-col items-center justify-center px-3 bg-white shrink-0 z-10 relative">
            <div className="text-stone-300 text-2xl select-none">→</div>
          </div>

          {/* 压缩后 */}
          <div className="flex-1 flex flex-col items-center bg-lime-100 px-6 py-5 min-w-0 overflow-hidden">
            <div className="text-xs font-medium text-emerald-700 mb-3">压缩后</div>
            <div
              className="flex-1 w-full flex items-center justify-center min-h-0 overflow-hidden"
              style={{ maxHeight: 'calc(90vh - 160px)' }}
            >
              <TransformWrapper>
                <TransformComponent
                  wrapperClass="!w-full !h-full"
                  contentClass="!w-full !h-full flex items-center justify-center"
                >
                  <img
                    src={toLocalURL(item.file)}
                    alt="compressed"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </TransformComponent>
              </TransformWrapper>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-stone-950 tabular-nums font-medium">
                {item.outputSize}
              </span>
              {item.saved && (
                <span className="text-xs bg-green-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                  节省 {item.saved}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 压缩对比面板
 *
 * @component
 * @param {Array} logs - 压缩进度日志列表（含 backupPath、inputBytes、outputBytes 字段）
 */
ComparePanel.propTypes = {
  logs: PropTypes.arrayOf(
    PropTypes.shape({
      status: PropTypes.string,
      file: PropTypes.string,
      backupPath: PropTypes.string,
      inputBytes: PropTypes.number,
      outputBytes: PropTypes.number,
      inputSize: PropTypes.string,
      outputSize: PropTypes.string,
      saved: PropTypes.string,
      error: PropTypes.string
    })
  ).isRequired
}
export default function ComparePanel({ logs }) {
  const [restoredSet, setRestoredSet] = useState(new Set())
  const [loadingSet, setLoadingSet] = useState(new Set())
  const [modalItem, setModalItem] = useState(null)

  const successItems = logs.filter((l) => l.status === 'success' && l.backupPath)

  const restore = useCallback(
    async (item) => {
      if (loadingSet.has(item.file)) return
      setLoadingSet((s) => new Set([...s, item.file]))
      try {
        await restoreFile(item.backupPath, item.file)
        setRestoredSet((s) => new Set([...s, item.file]))
      } catch (e) {
        alert('还原失败：' + e.message)
      } finally {
        setLoadingSet((s) => {
          const n = new Set(s)
          n.delete(item.file)
          return n
        })
      }
    },
    [loadingSet]
  )

  const openDir = useCallback((item) => {
    openInFinder(item.backupPath)
  }, [])

  if (successItems.length === 0) {
    return <div className="text-center py-10 text-stone-400 text-sm">没有可对比的文件</div>
  }

  return (
    <>
      {modalItem && <ImageCompareModal item={modalItem} onClose={() => setModalItem(null)} />}
      <div className="space-y-3">
        {successItems.map((item, i) => {
          const img = isImage(item.file)
          const isRestored = restoredSet.has(item.file)
          const isLoading = loadingSet.has(item.file)

          return (
            <div key={i} className="border border-stone-100 rounded-2xl p-4 bg-stone-50">
              {/* 文件名行 */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm shrink-0">{img ? '🖼' : '🎵'}</span>
                <span
                  className="flex-1 truncate text-xs text-stone-700 font-mono font-medium"
                  title={item.file}
                >
                  {basename(item.file)}
                </span>
                <button
                  onClick={() => openDir(item)}
                  title="在文件管理器中查看备份"
                  className="shrink-0 text-stone-300 hover:text-emerald-600 text-sm transition-colors"
                >
                  📂
                </button>
                <button
                  onClick={() => restore(item)}
                  disabled={isRestored || isLoading}
                  className={`shrink-0 text-xs px-2.5 py-1 rounded-2xl font-medium transition-colors ${
                    isRestored
                      ? 'bg-stone-100 text-stone-400 cursor-default'
                      : 'bg-red-50 text-red-500 hover:bg-red-100'
                  } disabled:opacity-60`}
                >
                  {isLoading ? '…' : isRestored ? '✓ 已还原' : '还原'}
                </button>
              </div>

              {/* 图片缩略图对比（点击放大） */}
              {img && (
                <div
                  className="flex gap-3 mb-1 cursor-zoom-in group relative"
                  onClick={() => setModalItem(item)}
                  title="点击放大对比"
                >
                  {/* 悬停提示 */}
                  <div className="absolute inset-0 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <span className="bg-black/50 text-white text-xs px-2.5 py-1 rounded-full backdrop-blur-sm">
                      🔍 点击放大对比
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-stone-400 mb-1 text-center">原始备份</div>
                    <div className="h-32 rounded-2xl bg-white border border-stone-200 overflow-hidden flex items-center justify-center group-hover:border-stone-300 transition-colors">
                      <LocalImage
                        filePath={item.backupPath}
                        className="max-h-full max-w-full object-contain"
                        alt="original"
                      />
                    </div>
                    <div className="text-[10px] text-stone-500 mt-1 text-center tabular-nums">
                      {item.inputSize}
                    </div>
                  </div>

                  <div className="flex items-center justify-center text-stone-300 text-lg shrink-0 mt-2">
                    →
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-emerald-700 mb-1 text-center">压缩后</div>
                    <div className="h-32 rounded-2xl bg-white border border-lime-200 overflow-hidden flex items-center justify-center group-hover:border-lime-300 transition-colors">
                      <LocalImage
                        filePath={item.file}
                        className="max-h-full max-w-full object-contain"
                        alt="compressed"
                      />
                    </div>
                    <div className="text-[10px] text-stone-950 mt-1 text-center tabular-nums">
                      {item.outputSize}
                    </div>
                  </div>
                </div>
              )}

              {/* 音频：双列播放器对比 */}
              {!img && (
                <div className="flex gap-3 mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-stone-400 mb-1 text-center">原始备份</div>
                    <div className="rounded-2xl bg-white border border-stone-200 px-2 py-1.5">
                      <LocalAudio filePath={item.backupPath} />
                    </div>
                    <div className="text-[10px] text-stone-500 mt-1 text-center tabular-nums">
                      {item.inputSize}
                    </div>
                  </div>
                  <div className="flex items-center justify-center text-stone-300 text-lg shrink-0 mt-2">
                    →
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-emerald-700 mb-1 text-center">压缩后</div>
                    <div className="rounded-2xl bg-white border border-lime-200 px-2 py-1.5">
                      <LocalAudio filePath={item.file} />
                    </div>
                    <div className="text-[10px] text-stone-950 mt-1 text-center tabular-nums">
                      {item.outputSize}
                    </div>
                  </div>
                </div>
              )}

              {/* 音频节省量 */}
              {!img && (
                <div className="mt-0.5 text-right text-xs text-stone-500">
                  节省 <span className="text-emerald-600 font-semibold">{item.saved}</span>
                </div>
              )}

              {/* 大小进度条 */}
              <SizeBar inputBytes={item.inputBytes} outputBytes={item.outputBytes} />

              {/* 图片额外展示节省量 */}
              {img && (
                <div className="mt-1.5 text-right text-xs text-stone-500">
                  节省 <span className="text-emerald-600 font-semibold">{item.saved}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
