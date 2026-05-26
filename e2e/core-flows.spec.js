import { expect, test } from '@playwright/test'
import { installTauriMock } from './tauri-mock.js'

test.beforeEach(async ({ page }) => {
  await installTauriMock(page)
  await page.goto('/')
})

test('image flow validates stored key, compresses, compares, and deletes backup', async ({
  page
}) => {
  await expect(page.getByText('自动校验完成：1/1 个 Key 可用')).toBeVisible()
  await expect(page.getByText('剩余 488')).toBeVisible()

  await page.getByRole('button', { name: '+ 添加文件' }).click()
  await expect(page.getByText('/tmp/photo.png')).toBeVisible()

  await page.getByRole('button', { name: '🚀 开始压缩' }).click()
  await expect(page.getByText('图片压缩完成：成功 1，失败 0，跳过 0')).toBeVisible()

  await page.getByRole('button', { name: /压缩对比/ }).click()
  await expect(page.getByText('成功记录 1')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '删除备份' }).click()
  await expect(page.getByText('已删除备份文件')).toBeVisible()
})

test('settings flow saves custom backup directory', async ({ page }) => {
  await page.getByRole('link', { name: /设置/ }).click()
  await page.getByRole('textbox', { name: '备份目录名' }).fill('custom_backup')
  await page.getByRole('button', { name: '保存' }).click()

  await expect(page.getByText('备份目录名已保存')).toBeVisible()
  const settings = await page.evaluate(() => window.__E2E_TAURI__.settings)
  expect(settings.backupDirName).toBe('custom_backup')
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
