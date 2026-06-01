/* global fetch, setTimeout */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { stdout } from 'node:process'

const endpoint = 'http://127.0.0.1:4444'
const manifest = JSON.parse(readFileSync(resolve('.tmp/tinypress-fixtures/manifest.json'), 'utf8'))

async function request(path, body) {
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new Error(`WebDriver ${path} failed: ${response.status} ${await response.text()}`)
  return response.json()
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(`${endpoint}/status`)
      return
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  throw new Error(`Timed out waiting for WebDriver at ${endpoint}`)
}

const waitFor = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await execute(`return (${predicate})`)).value) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

await waitForDriver()
const session = await request('/session', {
  capabilities: {
    alwaysMatch: {
      'tauri:options': { application: resolve('src-tauri/target/debug/tiny-app') }
    }
  }
})
const sessionId = session.value.sessionId ?? session.sessionId
const execute = (script, args = []) => request(`/session/${sessionId}/execute/sync`, { script, args })

try {
  await waitFor(`document.body.innerText.includes('TinyPress')`, 'desktop shell')
  await execute(`window.__TINYPRESS_E2E_PATHS__ = arguments[0]`, [{ files: [manifest.audio[0]], directories: [manifest.root, manifest.root] }])
  await execute(`location.hash = '#/audio'`)
  await waitFor(`document.body.innerText.includes('开始压缩')`, 'audio tool')
  await execute(`Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('+ 添加文件')).click()`)
  await waitFor(`document.body.innerText.includes('已添加 1 个文件或目录')`, 'injected audio fixture')
  await execute(`Array.from(document.querySelectorAll('button')).find((button) => button.innerText === '开始压缩').click()`)
  await waitFor(`document.body.innerText.includes('音频压缩完成')`, 'real ffmpeg compression')
  await execute(`window.__TINYPRESS_E2E_PATHS__ = arguments[0]`, [{ files: [manifest.images[0]], directories: [manifest.root, manifest.root] }])
  await execute(`location.hash = '#/settings?tab=image'`)
  await waitFor(`document.querySelector('input[placeholder="your-api-key"]')`, 'TinyPNG key manager')
  await execute(`
    const input = document.querySelector('input[placeholder="your-api-key"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'desktop-e2e-key');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  `)
  await execute(`location.hash = '#/png'`)
  await waitFor(`document.body.innerText.includes('开始压缩')`, 'image tool')
  await execute(`Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('+ 添加文件')).click()`)
  await waitFor(`document.body.innerText.includes('已添加 1 个文件或目录')`, 'injected image fixture')
  await execute(`Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('开始压缩')).click()`)
  await waitFor(`document.body.innerText.includes('图片压缩完成')`, 'local TinyPNG mock compression')
  await execute(`location.hash = '#/settings'`)
  await waitFor(`document.body.innerText.includes('夜间模式')`, 'appearance settings')
  stdout.write('desktop e2e passed\n')
} finally {
  await fetch(`${endpoint}/session/${sessionId}`, { method: 'DELETE' })
}
