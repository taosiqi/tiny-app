import { useState } from 'react'
import PropTypes from 'prop-types'
import { convertFileSrc } from '@tauri-apps/api/core'

function localUrl(filePath) {
  return filePath ? convertFileSrc(filePath) : ''
}

export default function ImageCompareSlider({
  leftPath,
  rightPath,
  leftLabel = '原始备份',
  rightLabel = '压缩后',
  height = 'h-80'
}) {
  const [position, setPosition] = useState(50)

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-stone-200 bg-white ${height}`}>
      <span className="absolute left-3 top-3 z-20 rounded-full bg-stone-950/70 px-2.5 py-1 text-[10px] font-semibold text-white">
        {leftLabel}
      </span>
      <span className="absolute right-3 top-3 z-20 rounded-full bg-emerald-700/80 px-2.5 py-1 text-[10px] font-semibold text-white">
        {rightLabel}
      </span>
      <img src={localUrl(rightPath)} className="h-full w-full object-contain" alt={rightLabel} />
      <div className="absolute inset-y-0 left-0 overflow-hidden bg-white" style={{ width: `${position}%` }}>
        <div className="h-full" style={{ width: `${10000 / Math.max(position, 1)}%` }}>
          <img src={localUrl(leftPath)} className="h-full w-full object-contain" alt={leftLabel} />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${position}%` }}>
        <div className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-[var(--theme-accent)] shadow-lg" />
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="absolute inset-x-4 bottom-3 accent-[var(--theme-accent)]"
        aria-label="图片对比滑块"
      />
    </div>
  )
}

ImageCompareSlider.propTypes = {
  leftPath: PropTypes.string.isRequired,
  rightPath: PropTypes.string.isRequired,
  leftLabel: PropTypes.string,
  rightLabel: PropTypes.string,
  height: PropTypes.string
}
