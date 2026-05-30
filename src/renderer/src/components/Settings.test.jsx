import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'
import { ToastProvider } from '../toast/ToastContext'

const saveSettings = vi.fn()

vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({
    settings: {
      nightMode: 'system',
      closeBehavior: 'background',
      backupDirName: '_tiny_backup',
      compression: { image: { recursiveScan: true }, audio: { recursiveScan: true, mp3: { bitrate: '96k', sampleRate: 44100, channels: 2 }, ogg: { bitrate: '96k', sampleRate: 44100, channels: 2 }, wav: { sampleRate: 22050, channels: 2 } } }
    },
    ready: true,
    saveSettings
  })
}))

vi.mock('../api/desktop', () => ({
  getRuntimeHealth: vi.fn(() =>
    Promise.resolve({
      appVersion: '2.1.0',
      ffmpegPath: '/tmp/ffmpeg',
      ffmpegExists: true,
      ffmpegAvailable: true,
      backupDirName: '_tiny_backup',
      tinypngKeyCount: 1
    })
  ),
  getTinypngKeys: vi.fn(() => Promise.resolve([])),
  updateTinypngKeys: vi.fn((keys) => Promise.resolve(keys)),
  checkTinypngKey: vi.fn(() => Promise.resolve({ valid: true, compressionCount: 12, error: null })),
  openExternal: vi.fn()
}))

function renderSettings(initialEntries = ['/settings']) {
  const router = createMemoryRouter([
    { path: '/settings', element: <ToastProvider><Settings /></ToastProvider> },
    { path: '/other', element: <div>其他页面</div> }
  ], { initialEntries })
  return { ...render(<RouterProvider router={router} />), router }
}

describe('Settings', () => {
  beforeEach(() => {
    saveSettings.mockClear()
  })

  it('saves appearance and close behavior choices', () => {
    renderSettings(['/settings?tab=appearance'])

    fireEvent.click(screen.getByRole('button', { name: /^夜间/ }))
    fireEvent.click(screen.getByRole('button', { name: /完全退出/ }))

    expect(saveSettings).toHaveBeenCalledWith({ nightMode: 'dark' })
    expect(saveSettings).toHaveBeenCalledWith({ closeBehavior: 'quit' })
  })

  it('saves valid backup directory names and rejects invalid names', () => {
    renderSettings(['/settings?tab=backup'])

    const input = screen.getByRole('textbox', { name: '备份目录名' })
    fireEvent.change(input, { target: { value: 'my_backup' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(saveSettings).toHaveBeenCalledWith({ backupDirName: 'my_backup' })

    saveSettings.mockClear()
    fireEvent.change(input, { target: { value: '../bad' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByText('备份目录名不能为空，且不能包含路径分隔符')).toBeInTheDocument()
  })

  it('shows preference center sections and key manager entry', async () => {
    renderSettings(['/settings?tab=image'])

    expect(screen.getByText('首选项')).toBeInTheDocument()
    expect(screen.getByText('TinyPNG Key')).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('your-api-key')).toBeInTheDocument()
  })

  it('fills a quick profile draft and saves only after confirmation', () => {
    renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '省空间' }))
    expect(saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存压缩设置' }))
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      compression: expect.objectContaining({
        audio: expect.objectContaining({ mp3: { bitrate: '48k', sampleRate: 32000, channels: 1 } })
      })
    }))
    expect(screen.queryByRole('button', { name: '通用' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '压缩预设' })).not.toBeInTheDocument()
  })

  it('blocks route changes while compression settings are dirty', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { router } = renderSettings()
    fireEvent.click(screen.getByRole('button', { name: '省空间' }))
    await act(() => router.navigate('/other'))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: '首选项' })).toBeInTheDocument()

    confirm.mockReturnValue(true)
    await act(() => router.navigate('/other'))
    expect(await screen.findByText('其他页面')).toBeInTheDocument()
    confirm.mockRestore()
  })
})
