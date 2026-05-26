import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TinyPNG from './TinyPNG'
import { ToastProvider } from '../toast/ToastContext'
import { checkTinypngKey, getTinypngKeys } from '../api/desktop'

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
  beforeEach(() => {
    vi.clearAllMocks()
    getTinypngKeys.mockResolvedValue([])
  })

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

  it('automatically validates stored keys on first entry', async () => {
    getTinypngKeys.mockResolvedValueOnce([{ value: 'stored-key', compressionCount: null }])
    checkTinypngKey.mockResolvedValueOnce({ valid: true, compressionCount: 12, error: null })

    render(
      <ToastProvider>
        <TinyPNG />
      </ToastProvider>
    )

    await waitFor(() => expect(checkTinypngKey).toHaveBeenCalledWith('stored-key'))
    expect(await screen.findByText('剩余 488')).toBeInTheDocument()
    expect(screen.getByText('自动校验完成：1/1 个 Key 可用')).toBeInTheDocument()
  })

  it('does not automatically validate when no stored key exists', async () => {
    render(
      <ToastProvider>
        <TinyPNG />
      </ToastProvider>
    )

    await waitFor(() => expect(getTinypngKeys).toHaveBeenCalled())
    expect(checkTinypngKey).not.toHaveBeenCalled()
  })
})
