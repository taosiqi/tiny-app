import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { stdout } from 'node:process'
import ffmpegPath from 'ffmpeg-static'

const root = resolve('.tmp/tinypress-fixtures')
const file = (...parts) => join(root, ...parts)
const ensure = (path) => mkdirSync(path, { recursive: true })
const run = (...args) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args, '-y'])

rmSync(root, { recursive: true, force: true })
ensure(file('nested'))
ensure(file('_tiny_backup'))

run('-f', 'lavfi', '-i', 'color=c=blue:s=96x64', '-frames:v', '1', file('sample.png'))
run('-f', 'lavfi', '-i', 'color=c=green:s=96x64', '-frames:v', '1', file('sample.jpg'))
run('-f', 'lavfi', '-i', 'color=c=yellow:s=96x64', '-frames:v', '1', file('sample.webp'))
run('-f', 'lavfi', '-i', 'color=c=purple:s=96x64', '-frames:v', '1', '-c:v', 'libaom-av1', '-still-picture', '1', file('sample.avif'))
run('-f', 'lavfi', '-i', 'color=c=red@0.45:s=96x64,format=rgba', '-frames:v', '1', file('transparent.png'))
run('-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=2:duration=2', '-loop', '0', file('animated.webp'))
run('-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=2:duration=2', '-f', 'apng', '-plays', '0', file('animated.png'))
run('-f', 'lavfi', '-i', 'color=c=red:s=48x48', '-frames:v', '1', file('nested', 'nested.png'))
run('-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-b:a', '256k', file('sample.mp3'))
run('-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-b:a', '192k', file('sample.ogg'))
run('-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', file('sample.wav'))
writeFileSync(file('ignore.txt'), 'unsupported extension\n')
writeFileSync(file('_tiny_backup', 'ignored.png'), 'excluded backup directory\n')

const manifest = {
  root,
  images: [file('sample.png'), file('sample.jpg'), file('sample.webp'), file('sample.avif'), file('transparent.png'), file('animated.webp'), file('animated.png'), file('nested', 'nested.png')],
  audio: [file('sample.mp3'), file('sample.ogg'), file('sample.wav')],
  directories: [root, file('nested'), root],
  invalid: [file('ignore.txt')],
  excluded: [file('_tiny_backup', 'ignored.png')]
}
ensure(dirname(file('manifest.json')))
writeFileSync(file('manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
stdout.write(`${file('manifest.json')}\n`)
