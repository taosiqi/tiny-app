/**
 * @file ComparePanel.jsx
 * @description 压缩前后对比面板
 *
 * 展示每个成功压缩文件的原始备份与压缩后文件的大小对比。
 * 图片类文件额外展示缩略图。支持一键还原至备份版本。
 */
import { useState, useCallback } from 'react'
import { basename, isImage } from '../utils/fileUtils'

/** 将本地绝对路径转为 local:// URL（兼容 Mac/Windows） */
function toLocalURL(filePath) {
  if (!filePath) return ''
  return 'local://' + filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
}

/** 本地图片展示 */
function LocalImage({ filePath, className, alt }) {
  if (!filePath) return null
  return <img src={toLocalURL(filePath)} className={className} alt={alt} />
}

/** 本地音频播放器：local:// 流式协议，支持 seek */
function LocalAudio({ filePath }) {
  if (!filePath) return null
  return (
    <audio controls src={toLocalURL(filePath)} className="w-full h-8" style={{ outline: 'none' }} />
  )
}

/**
 * 大小进度条：蓝色填充区域表示压缩后的相对大小 */
function SizeBar({ inputBytes, outputBytes }) {
  if (!inputBytes || !outputBytes || inputBytes === 0) return null
  const pct = Math.round((outputBytes / inputBytes) * 100)
  const saved = (((inputBytes - outputBytes) / inputBytes) * 100).toFixed(1)
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-400 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-green-600 w-12 text-right shrink-0 tabular-nums">
        -{saved}%
      </span>
    </div>
  )
}

/**
 * 压缩对比面板
 *
 * @component
 * @param {Array} logs - 压缩进度日志列表（含 backupPath、inputBytes、outputBytes 字段）
 */
export default function ComparePanel({ logs }) {
  const [restoredSet, setRestoredSet] = useState(new Set())
  const [loadingSet, setLoadingSet] = useState(new Set())

  const successItems = logs.filter((l) => l.status === 'success' && l.backupPath)

  const restore = useCallback(
    async (item) => {
      if (loadingSet.has(item.file)) return
      setLoadingSet((s) => new Set([...s, item.file]))
      try {
        await window.api.restoreFile(item.backupPath, item.file)
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
    window.api.openInFinder(item.backupPath)
  }, [])

  if (successItems.length === 0) {
    return <div className="text-center py-10 text-gray-400 text-sm">没有可对比的文件</div>
  }

  return (
    <div className="space-y-3">
      {successItems.map((item, i) => {
        const img = isImage(item.file)
        const isRestored = restoredSet.has(item.file)
        const isLoading = loadingSet.has(item.file)

        return (
          <div key={i} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
            {/* 文件名行 */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm shrink-0">{img ? '🖼' : '🎵'}</span>
              <span
                className="flex-1 truncate text-xs text-gray-700 font-mono font-medium"
                title={item.file}
              >
                {basename(item.file)}
              </span>
              <button
                onClick={() => openDir(item)}
                title="在文件管理器中查看备份"
                className="shrink-0 text-gray-300 hover:text-blue-400 text-sm transition-colors"
              >
                📂
              </button>
              <button
                onClick={() => restore(item)}
                disabled={isRestored || isLoading}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  isRestored
                    ? 'bg-gray-100 text-gray-400 cursor-default'
                    : 'bg-red-50 text-red-500 hover:bg-red-100'
                } disabled:opacity-60`}
              >
                {isLoading ? '…' : isRestored ? '✓ 已还原' : '还原'}
              </button>
            </div>

            {/* 图片缩略图对比 */}
            {img && (
              <div className="flex gap-3 mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-400 mb-1 text-center">原始备份</div>
                  <div className="h-32 rounded-lg bg-white border border-gray-200 overflow-hidden flex items-center justify-center">
                    <LocalImage
                      filePath={item.backupPath}
                      className="max-h-full max-w-full object-contain"
                      alt="original"
                    />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1 text-center tabular-nums">
                    {item.inputSize}
                  </div>
                </div>

                <div className="flex items-center justify-center text-gray-300 text-lg shrink-0 mt-2">
                  →
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-blue-500 mb-1 text-center">压缩后</div>
                  <div className="h-32 rounded-lg bg-white border border-blue-200 overflow-hidden flex items-center justify-center">
                    <LocalImage
                      filePath={item.file}
                      className="max-h-full max-w-full object-contain"
                      alt="compressed"
                    />
                  </div>
                  <div className="text-[10px] text-blue-600 mt-1 text-center tabular-nums">
                    {item.outputSize}
                  </div>
                </div>
              </div>
            )}

            {/* 音频：双列播放器对比 */}
            {!img && (
              <div className="flex gap-3 mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-400 mb-1 text-center">原始备份</div>
                  <div className="rounded-lg bg-white border border-gray-200 px-2 py-1.5">
                    <LocalAudio filePath={item.backupPath} />
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1 text-center tabular-nums">
                    {item.inputSize}
                  </div>
                </div>
                <div className="flex items-center justify-center text-gray-300 text-lg shrink-0 mt-2">
                  →
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-blue-500 mb-1 text-center">压缩后</div>
                  <div className="rounded-lg bg-white border border-blue-200 px-2 py-1.5">
                    <LocalAudio filePath={item.file} />
                  </div>
                  <div className="text-[10px] text-blue-600 mt-1 text-center tabular-nums">
                    {item.outputSize}
                  </div>
                </div>
              </div>
            )}

            {/* 音频节省量 */}
            {!img && (
              <div className="mt-0.5 text-right text-xs text-gray-500">
                节省 <span className="text-green-600 font-semibold">{item.saved}</span>
              </div>
            )}

            {/* 大小进度条 */}
            <SizeBar inputBytes={item.inputBytes} outputBytes={item.outputBytes} />

            {/* 图片额外展示节省量 */}
            {img && (
              <div className="mt-1.5 text-right text-xs text-gray-500">
                节省 <span className="text-green-600 font-semibold">{item.saved}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
