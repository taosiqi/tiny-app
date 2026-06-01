import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process, { stderr, stdout } from 'node:process'

const root = resolve('.')
const renderer = join(root, 'src/renderer/src')
const failures = []

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

for (const path of files(join(renderer, 'components'))) {
  if (!path.endsWith('.jsx') || path.endsWith('/ui/base.jsx')) continue
  const text = readFileSync(path, 'utf8')
  if (/<select[\s>]/.test(text)) failures.push(`${relative(root, path)}: use AppSelectField instead of raw <select>`)
  if (path.endsWith('/Settings.jsx') && /bg-white\/(?:70|72)/.test(text)) failures.push(`${relative(root, path)}: move repeated surface styling into shared components`)
}

const history = readFileSync(join(renderer, 'tasks/taskHistory.js'), 'utf8')
if (!history.includes("tinypress_task_records_v6")) failures.push('taskHistory.js: expected tinypress_task_records_v6')

const compression = readFileSync(join(renderer, 'settings/compressionSettings.js'), 'utf8')
for (const marker of ['minQuality', 'maxQuality', 'maxColors', 'progressive']) {
  if (compression.includes(marker)) failures.push(`compressionSettings.js: deprecated image marker ${marker}`)
}

if (failures.length) {
  stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
} else {
  stdout.write('TinyPress convention audit passed\n')
}
