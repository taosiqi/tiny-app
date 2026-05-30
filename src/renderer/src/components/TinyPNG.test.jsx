import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TinyPNG from './TinyPNG'
import { ToastProvider } from '../toast/ToastContext'
import {
  checkTinypngKey,
  compressImage,
  getTinypngKeys,
  onImagePaused,
  openFiles
} from '../api/desktop'

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
  openDirectories: vi.fn(async () => []),
  openExternal: vi.fn(),
  openFiles: vi.fn(async () => []),
  stopImageCompression: vi.fn(),
  updateTinypngKeys: vi.fn(async () => {})
}))

vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({
    settings: {
      defaultPresetId: 'balanced',
      compressionPresets: {
        balanced: { recursiveScan: true, audioFormat: 'mixed', audioQuality: 'medium' }
      }
    }
  })
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

  it('validates individual keys and shows exhausted key state', async () => {
    checkTinypngKey.mockResolvedValueOnce({
      valid: true,
      compressionCount: 500,
      error: '当月已达上限'
    })

    render(
      <ToastProvider>
        <TinyPNG />
      </ToastProvider>
    )

    await waitFor(() => expect(getTinypngKeys).toHaveBeenCalled())
    fireEvent.change(screen.getByPlaceholderText('your-api-key'), {
      target: { value: 'manual-key' }
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '验证' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '验证' }))

    await waitFor(() => expect(checkTinypngKey).toHaveBeenCalledWith('manual-key'))
    expect(await screen.findByText('已耗尽')).toBeInTheDocument()
    expect(screen.getByText('当月已达上限')).toBeInTheDocument()
  })

  it('keeps validate and delete key actions the same size', async () => {
    render(<ToastProvider><TinyPNG /></ToastProvider>)
    await waitFor(() => expect(getTinypngKeys).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '验证' })).toHaveClass('h-8', 'w-14')
    expect(screen.getByRole('button', { name: '删除' })).toHaveClass('h-8', 'w-14')
  })

  it('starts image compression with selected files and recursive setting', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/photo.png'])
    compressImage.mockResolvedValueOnce()

    render(
      <ToastProvider>
        <TinyPNG />
      </ToastProvider>
    )

    fireEvent.change(screen.getByPlaceholderText('your-api-key'), { target: { value: 'key-a' } })
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    expect(await screen.findByText('/tmp/photo.png')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('递归子目录'))
    fireEvent.click(screen.getByRole('button', { name: '🚀 开始压缩' }))

    await waitFor(() =>
      expect(compressImage).toHaveBeenCalledWith({
        paths: ['/tmp/photo.png'],
        apiKeys: ['key-a'],
        recursive: false
      })
    )
  })

  it('pauses and continues remaining image compression work', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/photo.png'])
    compressImage.mockResolvedValue()

    render(
      <ToastProvider>
        <TinyPNG />
      </ToastProvider>
    )

    fireEvent.change(screen.getByPlaceholderText('your-api-key'), { target: { value: 'key-a' } })
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('/tmp/photo.png')
    fireEvent.click(screen.getByRole('button', { name: '🚀 开始压缩' }))

    await waitFor(() => expect(onImagePaused).toHaveBeenCalled())
    onImagePaused.mock.calls.at(-1)[0]({ remaining: ['/tmp/left.png'] })

    expect(await screen.findByRole('button', { name: '▶ 继续压缩（1 张）' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '▶ 继续压缩（1 张）' }))

    await waitFor(() =>
      expect(compressImage).toHaveBeenLastCalledWith({
        paths: ['/tmp/left.png'],
        apiKeys: ['key-a'],
        recursive: true
      })
    )
  })
})
