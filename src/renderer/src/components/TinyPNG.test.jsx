import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TinyPNG from './TinyPNG'
import { ToastProvider } from '../toast/ToastContext'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path) => `asset://${path}`
}))

vi.mock('../api/desktop', () => ({
  checkTinypngKey: vi.fn(),
  compressImage: vi.fn(),
  getTinypngKeys: vi.fn(async () => []),
  onImageDone: vi.fn(() => () => {}),
  onImageKeyCount: vi.fn(() => () => {}),
  onImagePaused: vi.fn(() => () => {}),
  onImageProgress: vi.fn(() => () => {}),
  onImageTotal: vi.fn(() => () => {}),
  openDirectory: vi.fn(),
  openExternal: vi.fn(),
  openFiles: vi.fn(async () => []),
  stopImageCompression: vi.fn(),
  updateTinypngKeys: vi.fn(async () => {})
}))

describe('TinyPNG', () => {
  it('shows a toast instead of alert when starting without keys', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(
      <ToastProvider>
        <TinyPNG />
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '🚀 开始压缩' }))

    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByText('请先填写 TinyPNG API Key')).toBeInTheDocument()
    alertSpy.mockRestore()
  })
})
