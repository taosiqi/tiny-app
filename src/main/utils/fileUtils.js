/**
 * @file main/utils/fileUtils.js
 * @description 主进程文件相关工具函数
 */
import fs from 'fs'
import path from 'path'

/**
 * 收集目录下所有匹配扩展名的文件路径，自动跳过 _tiny_backup 目录
 * @param {string}   dir       起始目录
 * @param {string[]} exts      允许的小写扩展名，如 ['.png', '.jpg']
 * @param {string[]} results   结果数组，收集到的路径追加至此
 * @param {boolean}  [recursive=true] 是否递归子目录
 */
export function collectFiles(dir, exts, results, recursive = true) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '_tiny_backup') continue
      if (recursive) collectFiles(full, exts, results, recursive)
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      results.push(full)
    }
  }
}

/**
 * 将字节数格式化为人类可读字符串（B / KB / MB / GB）
 * @param {number} bytes
 * @returns {string} 如 "1.23 MB"
 */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 压缩前将原始文件备份至同目录的 _tiny_backup/ 子文件夹
 * 若备份文件已存在则不覆盖（保留最原始版本，支持多次压缩后仍可还原）
 * @param {string} filePath 原始文件绝对路径
 * @returns {string} 备份文件的绝对路径
 */
export function backupFile(filePath) {
  const dir = path.dirname(filePath)
  const name = path.basename(filePath)
  const backupDir = path.join(dir, '_tiny_backup')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, name)
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath)
  }
  return backupPath
}
