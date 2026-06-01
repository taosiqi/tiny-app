import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AudioTool from './AudioTool'
import { ToastProvider } from '../toast/ToastContext'
import { compressAudio, onAudioDone, onAudioPaused, openFiles } from '../api/desktop'
import { TASK_RECORDS_KEY } from '../tasks/taskHistory'

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path) => `asset://${path}` }))
vi.mock('../api/desktop', () => ({
  compressAudio: vi.fn(), onAudioDone: vi.fn(() => () => {}), onAudioPaused: vi.fn(() => () => {}),
  onAudioProgress: vi.fn(() => () => {}), onAudioTotal: vi.fn(() => () => {}),
  openDirectories: vi.fn(async () => []), openFiles: vi.fn(async () => []), stopAudioCompression: vi.fn()
}))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ settings: { compression: { image: { recursiveScan: true }, audio: { recursiveScan: false, mp3: { bitrate: '96k', sampleRate: 44100, channels: 2 }, ogg: { bitrate: '160k', sampleRate: 48000, channels: 2 }, wav: { sampleRate: 22050, channels: 2 } } } } })
}))

const expectedPayload = (paths) => ({
  paths, recursive: false,
  mp3: { bitrate: '96k', sampleRate: 44100, channels: 2 },
  ogg: { bitrate: '160k', sampleRate: 48000, channels: 2 },
  wav: { sampleRate: 22050, channels: 2 }
})
const renderPage = () => render(<ToastProvider><MemoryRouter><AudioTool /></MemoryRouter></ToastProvider>)

describe('AudioTool', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); openFiles.mockResolvedValue([]) })

  it('shows the saved compression summary without temporary controls', () => {
    renderPage()
    expect(screen.getByText(/MP3 96k \/ OGG 160k \/ WAV 22.05kHz/)).toBeInTheDocument()
    expect(screen.queryByLabelText('递归子目录')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('压缩预设')).not.toBeInTheDocument()
  })

  it('starts audio compression with saved format settings', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/audio.ogg'])
    compressAudio.mockResolvedValueOnce()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('已添加 1 个文件或目录')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))
    await waitFor(() => expect(compressAudio).toHaveBeenCalledWith(expectedPayload(['/tmp/audio.ogg'])))
  })

  it('pauses and continues remaining files', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/audio.mp3'])
    compressAudio.mockResolvedValue()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('已添加 1 个文件或目录')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))
    await waitFor(() => expect(onAudioPaused).toHaveBeenCalled())
    onAudioPaused.mock.calls.at(-1)[0]({ remaining: ['/tmp/left.mp3'] })
    const records = JSON.parse(localStorage.getItem(TASK_RECORDS_KEY))
    expect(records[0].status).toBe('paused')
    expect(records[0].logs.at(-1).status).toBe('paused')
    fireEvent.click(await screen.findByRole('button', { name: '继续压缩（1 个）' }))
    await waitFor(() => expect(compressAudio).toHaveBeenLastCalledWith(expectedPayload(['/tmp/left.mp3'])))
  })

  it('clears paths only after a fully successful task', async () => {
    openFiles.mockResolvedValueOnce(['/tmp/audio.mp3'])
    compressAudio.mockResolvedValue()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('已添加 1 个文件或目录')
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))
    await waitFor(() => expect(onAudioDone).toHaveBeenCalled())
    onAudioDone.mock.calls.at(-1)[0]({ total: 1, processed: 1, skipped: 0, failed: 0, savedBytes: '1 KB' })
    expect(await screen.findByText('点击上方按钮添加 .mp3 / .ogg / .wav 文件或目录')).toBeInTheDocument()
  })
})
