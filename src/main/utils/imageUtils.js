/**
 * @file main/utils/imageUtils.js
 * @description TinyPNG 图片压缩与 API Key 校验
 */
import fs from 'fs'
import axios from 'axios'

// 用于探测 Key 有效性的最小合法 1×1 PNG（base64 编码）
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * 通过 TinyPNG API 压缩单张图片（原地覆盖）
 *
 * 若压缩后体积 >= 原始大小则跳过，不覆写文件。
 *
 * @param {string} filePath 图片本地绝对路径
 * @param {string} apiKey   TinyPNG API Key
 * @returns {Promise<{success: boolean, inputSize: number, outputSize: number, savedBytes?: number, compressionCount: number, reason?: string}>}
 */
export async function compressImage(filePath, apiKey) {
  const fileData = fs.readFileSync(filePath)
  const uploadRes = await axios.post('https://api.tinify.com/shrink', fileData, {
    headers: { 'Content-Type': 'application/octet-stream' },
    auth: { username: 'api', password: apiKey },
    timeout: 60000
  })
  const compressionCount = parseInt(uploadRes.headers['compression-count'] || '0', 10)
  const { input, output } = uploadRes.data
  if (output.size < input.size) {
    const dlRes = await axios.get(output.url, {
      responseType: 'arraybuffer',
      auth: { username: 'api', password: apiKey },
      timeout: 60000
    })
    fs.writeFileSync(filePath, Buffer.from(dlRes.data))
    return {
      success: true,
      inputSize: input.size,
      outputSize: output.size,
      savedBytes: input.size - output.size,
      compressionCount
    }
  }
  return {
    success: false,
    inputSize: input.size,
    outputSize: output.size,
    reason: '压缩后无体积减小，已跳过',
    compressionCount
  }
}

/**
 * 检查 TinyPNG API Key 有效性及当月已用次数
 *
 * HTTP 200/201 → 有效；401 → 无效；429 → 已达 500 次上限。
 *
 * @param {string} apiKey
 * @returns {Promise<{valid: boolean, compressionCount?: number, remaining?: number, error?: string}>}
 */
export async function checkTinypngKey(apiKey) {
  try {
    const res = await axios.post('https://api.tinify.com/shrink', TINY_PNG, {
      headers: { 'Content-Type': 'application/octet-stream' },
      auth: { username: 'api', password: apiKey },
      timeout: 30000,
      validateStatus: (s) => s === 200 || s === 201
    })
    const compressionCount = parseInt(res.headers['compression-count'] || '0', 10)
    return { valid: true, compressionCount, remaining: 500 - compressionCount }
  } catch (e) {
    const status = e.response?.status
    if (status === 401) return { valid: false, error: 'API Key 无效' }
    if (status === 429) {
      const compressionCount = parseInt(e.response?.headers?.['compression-count'] ?? '500', 10)
      return { valid: true, compressionCount, remaining: 0, error: '当月已达上限' }
    }
    if (e.code === 'ECONNABORTED' || e.message?.includes('timeout')) {
      return { valid: false, error: '请求超时，请检查网络' }
    }
    return { valid: false, error: '网络错误：' + (e.response?.data?.message || e.message) }
  }
}
