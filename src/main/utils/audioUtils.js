/**
 * @file main/utils/audioUtils.js
 * @description 使用 ffmpeg 压缩音频文件
 */
import { spawn } from 'child_process'
import fs from 'fs'

/**
 * 使用 ffmpeg 压缩单个音频文件（原地覆盖）
 *
 * - MP3：输出 64kbps 单声道 44.1kHz
 * - OGG：输出 libvorbis 96kbps 44.1kHz
 *
 * 先写入同目录临时文件，若压缩后体积更小则覆写源文件，否则删除临时文件不覆写。
 *
 * @param {string}        filePath  音频文件本地绝对路径
 * @param {'mp3'|'ogg'}   format    目标格式
 * @param {string}        ffmpegBin ffmpeg 可执行文件路径
 * @returns {Promise<{success: boolean, inputSize: number, outputSize: number, savedBytes?: number, reason?: string}>}
 */
export function compressAudioFile(filePath, format, ffmpegBin) {
  return new Promise((resolve, reject) => {
    const originalSize = fs.statSync(filePath).size
    const tempFile = filePath + '.tmp' + (format === 'mp3' ? '.mp3' : '.ogg')
    const args =
      format === 'mp3'
        ? [
            '-i',
            filePath,
            '-b:a',
            '64k',
            '-acodec',
            'mp3',
            '-ar',
            '44100',
            '-ac',
            '1',
            tempFile,
            '-y'
          ]
        : ['-i', filePath, '-c:a', 'libvorbis', '-b:a', '96k', '-ar', '44100', tempFile, '-y']

    const child = spawn(ffmpegBin, args, { stdio: 'pipe' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
        return reject(new Error('ffmpeg failed with code ' + code))
      }
      const compressedSize = fs.statSync(tempFile).size
      if (compressedSize < originalSize) {
        fs.copyFileSync(tempFile, filePath)
        fs.unlinkSync(tempFile)
        resolve({
          success: true,
          inputSize: originalSize,
          outputSize: compressedSize,
          savedBytes: originalSize - compressedSize
        })
      } else {
        fs.unlinkSync(tempFile)
        resolve({
          success: false,
          inputSize: originalSize,
          outputSize: compressedSize,
          reason: 'no size reduction'
        })
      }
    })
  })
}
