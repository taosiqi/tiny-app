import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TinyPNG from './TinyPNG'
import { ToastProvider } from '../toast/ToastContext'
import { checkTinypngKey, compressImage, getTinypngKeys, onImagePaused, openFiles } from '../api/desktop'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset://${path}` }))
vi.mock('../api/desktop', () => ({
  checkTinypngKey: vi.fn(), compressImage: vi.fn(), getTinypngKeys: vi.fn(async () => []),
  onImageDone: vi.fn(() => () => {}), onImageKeyCount: vi.fn(() => () => {}),
  onImagePaused: vi.fn(() => () => {}), onImageProgress: vi.fn(() => () => {}),
  onImageTotal: vi.fn(() => () => {}), openDirectories: vi.fn(async () => []),
  openFiles: vi.fn(async () => []), stopImageCompression: vi.fn(), updateTinypngKeys: vi.fn(async (keys) => keys)
}))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { compression: { image: { recursiveScan: true }, audio: { recursiveScan: true, mp3: { bitrate: '96k', sampleRate: 44100, channels: 2 }, ogg: { bitrate: '96k', sampleRate: 44100, channels: 2 }, wav: { sampleRate: 22050, channels: 2 } } } } })
}))

const renderPage = (initialEntries = ['/png']) => render(<MemoryRouter initialEntries={initialEntries}><ToastProvider><TinyPNG /></ToastProvider></MemoryRouter>)

describe('TinyPNG', () => {
  const local = {
    png: { mode: 'lossy', minQuality: 70, maxQuality: 90, maxColors: 256 },
    jpeg: { quality: 82, progressive: true },
    webp: { mode: 'lossy', quality: 80 },
    avif: { quality: 70, speed: 6 }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    getTinypngKeys.mockResolvedValue([])
    checkTinypngKey.mockResolvedValue({ valid: true, compressionCount: 10, error: null })
  })

  it('allows local fallback when starting without keys', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/photo.png'])
    compressImage.mockResolvedValueOnce()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('已添加 1 个文件或目录')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))
    await waitFor(() => expect(compressImage).toHaveBeenCalledWith({ paths: ['/tmp/photo.png'], apiKeys: [], recursive: true, engine: 'auto', local }))
  })

  it('shows a compact automatically validated key summary', async () => {
    getTinypngKeys.mockResolvedValueOnce([{ value: 'stored-key', compressionCount: null }])
    checkTinypngKey.mockResolvedValueOnce({ valid: true, compressionCount: 12, error: null })
    renderPage()
    await waitFor(() => expect(checkTinypngKey).toHaveBeenCalledWith('stored-key'))
    expect(await screen.findByText('可用 Key 1 个')).toBeInTheDocument()
    expect(screen.getByText('剩余额度合计 488 次')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理 Key' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('your-api-key')).not.toBeInTheDocument()
  })

  it('starts image compression with saved keys and recursive setting', async () => {
    getTinypngKeys.mockResolvedValueOnce([{ value: 'key-a', compressionCount: 10 }])
    openFiles.mockResolvedValueOnce(['/tmp/photo.png'])
    compressImage.mockResolvedValueOnce()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('已添加 1 个文件或目录')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))
    await waitFor(() => expect(compressImage).toHaveBeenCalledWith({ paths: ['/tmp/photo.png'], apiKeys: ['key-a'], recursive: true, engine: 'auto', local }))
  })

  it('pauses and continues remaining image compression work', async () => {
    getTinypngKeys.mockResolvedValueOnce([{ value: 'key-a', compressionCount: 10 }])
    openFiles.mockResolvedValueOnce(['/tmp/photo.png'])
    compressImage.mockResolvedValue()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('已添加 1 个文件或目录')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))
    await waitFor(() => expect(onImagePaused).toHaveBeenCalled())
    onImagePaused.mock.calls.at(-1)[0]({ remaining: ['/tmp/left.png'] })
    fireEvent.click(await screen.findByRole('button', { name: '继续压缩（1 张）' }))
    await waitFor(() => expect(compressImage).toHaveBeenLastCalledWith({ paths: ['/tmp/left.png'], apiKeys: ['key-a'], recursive: true, engine: 'auto', local }))
  })

  it('merges route retry paths without automatically starting compression', async () => {
    renderPage([{ pathname: '/png', state: { retryPaths: ['/tmp/a.png', '/tmp/a.png'], retryToken: 'retry-1' } }])
    expect(await screen.findByText('已添加 1 个文件或目录')).toBeInTheDocument()
    expect(compressImage).not.toHaveBeenCalled()
  })
})
