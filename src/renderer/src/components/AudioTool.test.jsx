import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AudioTool from './AudioTool'
import { ToastProvider } from '../toast/ToastContext'
import { compressAudio, onAudioPaused, openFiles } from '../api/desktop'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path) => `asset://${path}`
}))

vi.mock('../api/desktop', () => ({
  compressAudio: vi.fn(),
  onAudioDone: vi.fn(() => () => {}),
  onAudioPaused: vi.fn(() => () => {}),
  onAudioProgress: vi.fn(() => () => {}),
  onAudioTotal: vi.fn(() => () => {}),
  openDirectory: vi.fn(),
  openFiles: vi.fn(async () => []),
  stopAudioCompression: vi.fn()
}))

describe('AudioTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    openFiles.mockResolvedValue([])
  })

  it('defaults to mixed mode and can switch formats', () => {
    render(
      <MemoryRouter initialEntries={['/audio']}>
        <AudioTool />
      </MemoryRouter>
    )

    expect(screen.getByText('音频压缩')).toBeInTheDocument()
    expect(screen.getByText('自动按文件扩展名选择压缩策略')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'OGG' }))

    expect(screen.getByText('OGG 压缩')).toBeInTheDocument()
    expect(screen.getByText('Vorbis 96kbps')).toBeInTheDocument()
  })

  it('shows a toast instead of alert when starting without files', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/audio']}>
          <AudioTool />
        </MemoryRouter>
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))

    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByText('请先添加文件或目录')).toBeInTheDocument()
    alertSpy.mockRestore()
  })

  it('starts audio compression with selected format and recursive setting', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/audio.ogg'])
    compressAudio.mockResolvedValueOnce()

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/audio']}>
          <AudioTool />
        </MemoryRouter>
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'OGG' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    expect(await screen.findByText('/tmp/audio.ogg')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('递归子目录'))
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))

    await waitFor(() =>
      expect(compressAudio).toHaveBeenCalledWith({
        paths: ['/tmp/audio.ogg'],
        format: 'ogg',
        recursive: false
      })
    )
  })

  it('pauses and retries audio compression failures', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/audio.mp3'])
    compressAudio.mockRejectedValueOnce(new Error('boom')).mockResolvedValue()

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/audio?format=mp3']}>
          <AudioTool />
        </MemoryRouter>
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('/tmp/audio.mp3')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '↺' }))

    await waitFor(() =>
      expect(compressAudio).toHaveBeenLastCalledWith({
        paths: ['/tmp/audio.mp3'],
        format: 'mp3',
        recursive: true
      })
    )
  })

  it('shows paused state and continues remaining audio files', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/audio.mp3'])
    compressAudio.mockResolvedValue()

    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/audio']}>
          <AudioTool />
        </MemoryRouter>
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('/tmp/audio.mp3')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))

    await waitFor(() => expect(onAudioPaused).toHaveBeenCalled())
    onAudioPaused.mock.calls.at(-1)[0]({ remaining: ['/tmp/left.mp3'] })

    expect(await screen.findByRole('button', { name: '继续压缩（1 个）' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续压缩（1 个）' }))

    await waitFor(() =>
      expect(compressAudio).toHaveBeenLastCalledWith({
        paths: ['/tmp/left.mp3'],
        format: 'mixed',
        recursive: true
      })
    )
  })
})
