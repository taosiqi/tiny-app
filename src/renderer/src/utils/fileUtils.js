/**
 * @file renderer/src/utils/fileUtils.js
 * @description 渲染层文件相关工具函数（纯函数，无副作用）
 */

/** 从完整路径中提取文件名，兼容 Windows 反斜杠 */
export function basename(p) {
  return p.replace(/\\/g, '/').split('/').pop()
}

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'])
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac'])
const TEXT_EXTS = new Set(['.txt', '.json', '.md', '.css', '.js', '.jsx', '.ts', '.tsx', '.html', '.xml'])

export function extname(p) {
  const name = basename(p)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

/** 判断路径是否为图片文件 */
export function isImage(p) {
  return IMG_EXTS.has(extname(p))
}

export function isAudio(p) {
  return AUDIO_EXTS.has(extname(p))
}

export function isText(p) {
  return TEXT_EXTS.has(extname(p))
}

export function formatTimestamp(seconds) {
  if (!seconds) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(seconds * 1000))
}
