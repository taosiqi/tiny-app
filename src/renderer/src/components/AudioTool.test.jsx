import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AudioTool from './AudioTool'
import { ToastProvider } from '../toast/ToastContext'

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
})
