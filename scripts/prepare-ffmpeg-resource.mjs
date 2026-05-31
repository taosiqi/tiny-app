import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { platform, stdout } from 'node:process'
import ffmpegPath from 'ffmpeg-static'

if (!ffmpegPath) throw new Error('ffmpeg-static did not provide a platform binary')

const target = resolve('src-tauri/resources', platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
mkdirSync(dirname(target), { recursive: true })
copyFileSync(ffmpegPath, target)
if (platform !== 'win32') chmodSync(target, 0o755)
stdout.write(`Prepared ${basename(target)} from ffmpeg-static\n`)
