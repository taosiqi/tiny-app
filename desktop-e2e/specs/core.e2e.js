/* global describe, it, browser, expect, $, window */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('TinyPress desktop', () => {
  it('opens the real desktop shell and accepts injected fixture paths', async () => {
    const manifest = JSON.parse(readFileSync(resolve('.tmp/tinypress-fixtures/manifest.json'), 'utf8'))
    await browser.execute((paths) => { window.__TINYPRESS_E2E_PATHS__ = paths }, {
      files: [manifest.audio[0]],
      directories: [manifest.root, manifest.root]
    })
    await expect($('body')).toBeDisplayed()
    await expect($('body')).toHaveText(expect.stringContaining('TinyPress'))
  })
})
