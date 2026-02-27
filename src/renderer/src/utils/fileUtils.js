/**
 * @file renderer/src/utils/fileUtils.js
 * @description 渲染层文件相关工具函数（纯函数，无副作用）
 */

/** 从完整路径中提取文件名，兼容 Windows 反斜杠 */
export function basename(p) {
  return p.replace(/\\/g, '/').split('/').pop()
}

const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

/** 判断路径是否为图片文件 */
export function isImage(p) {
  return IMG_EXTS.has('.' + p.split('.').pop().toLowerCase())
}
