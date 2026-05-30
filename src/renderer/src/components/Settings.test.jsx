import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
      taskPreset: 'balanced'
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
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <Settings />
      </ToastProvider>
    </MemoryRouter>
  )
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

    expect(screen.getByText('偏好中心')).toBeInTheDocument()
    expect(screen.getByText('TinyPNG Key')).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('your-api-key')).toBeInTheDocument()
  })

  it('saves the default task preset from general preferences', () => {
    renderSettings(['/settings'])

    fireEvent.click(screen.getByRole('button', { name: /^最小体积/ }))

    expect(saveSettings).toHaveBeenCalledWith({ taskPreset: 'compact' })
    expect(screen.queryByRole('button', { name: '管理 Key' })).not.toBeInTheDocument()
  })
})
