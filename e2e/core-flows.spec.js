import { expect, test } from '@playwright/test'
import { installTauriMock } from './tauri-mock.js'

test.beforeEach(async ({ page }) => {
  await installTauriMock(page)
  await page.goto('/')
})

test('main pages use consistent compact headers', async ({ page }) => {
  for (const [label, heading] of [
    ['任务中心', '任务中心'],
    ['图片压缩', '图片压缩'],
    ['音频压缩', '音频压缩'],
    ['文件对比', '文件对比'],
    ['首选项', '首选项']
  ]) {
    await page.getByRole('link', { name: new RegExp(label) }).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }
  await page.setViewportSize({ width: 760, height: 900 })
  await page.getByRole('link', { name: /任务中心/ }).click()
  await expect(page.getByRole('heading', { name: '任务中心', exact: true })).toBeVisible()
})

test('image flow validates stored key, compresses, compares, and deletes backup', async ({
  page
}) => {
  await page.getByRole('link', { name: /图片压缩/ }).click()
  await expect(page.getByText('自动校验完成：1/1 个 Key 可用')).toBeVisible()
  await expect(page.getByText('剩余额度合计 488 次')).toBeVisible()

  await page.getByRole('button', { name: '+ 添加文件' }).click()
  await expect(page.getByText('已添加 1 个文件或目录')).toBeVisible()

  await page.getByRole('button', { name: '开始压缩' }).click()
  await expect(page.getByText('图片压缩完成：成功 1，失败 0，跳过 0')).toBeVisible()

  await page.getByRole('button', { name: /压缩对比/ }).click()
  await expect(page.getByText('成功记录 1')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除备份' }).click()
  await expect(page.getByText('已删除备份文件')).toBeVisible()
})

test('settings flow saves custom backup directory', async ({ page }) => {
  await page.getByRole('link', { name: /首选项/ }).click()
  await page.getByRole('button', { name: '备份与还原' }).click()
  await page.getByRole('textbox', { name: '备份目录名' }).fill('custom_backup')
  await page.getByRole('button', { name: '保存' }).click()

  await expect(page.getByText('备份目录名已保存')).toBeVisible()
  const settings = await page.evaluate(() => window.__E2E_TAURI__.settings)
  expect(settings.backupDirName).toBe('custom_backup')
})

test('appearance flow switches to readable dark mode', async ({ page }) => {
  await page.getByRole('link', { name: /首选项/ }).click()
  await page.getByRole('button', { name: '外观', exact: true }).click()
  await page.getByRole('button', { name: /^夜间/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-night', 'dark')
  await expect(page.getByRole('heading', { name: '夜间模式' })).toBeVisible()
})

test('feedback flow opens a mailto link', async ({ page }) => {
  await page.getByRole('button', { name: '邮件反馈' }).click()

  const calls = await page.evaluate(() => window.__E2E_TAURI__.calls)
  expect(calls).toContainEqual(
    expect.objectContaining({
      command: 'open_external',
      args: expect.objectContaining({
        url: expect.stringContaining('mailto:hksiqijson@gmail.com')
      })
    })
  )
})
