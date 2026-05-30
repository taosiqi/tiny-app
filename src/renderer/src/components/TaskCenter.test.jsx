import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCenter from './TaskCenter'
import { ToastProvider } from '../toast/ToastContext'
import { TASK_HISTORY_KEY } from '../tasks/taskHistory'

const listeners = new Map()

vi.mock('./ComparePanel', () => ({
  default: () => <div>ComparePanel</div>
}))

vi.mock('../api/desktop', () => ({
  getTinypngKeys: vi.fn(() => Promise.resolve([{ value: 'key-a', compressionCount: 10 }])),
  updateTinypngKeys: vi.fn((keys) => Promise.resolve(keys)),
  checkTinypngKey: vi.fn(() => Promise.resolve({ valid: true, compressionCount: 12, error: null })),
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
  openFiles: vi.fn(() => Promise.resolve(['/tmp/photo.png'])),
  openDirectory: vi.fn(() => Promise.resolve('/tmp/assets')),
  restoreFile: vi.fn(() => Promise.resolve()),
  stopAudioCompression: vi.fn(() => Promise.resolve()),
  stopImageCompression: vi.fn(() => Promise.resolve()),
  onImageTotal: vi.fn((cb) => {
    listeners.set('imageTotal', cb)
    return () => listeners.delete('imageTotal')
  }),
  onImageProgress: vi.fn((cb) => {
    listeners.set('imageProgress', cb)
    return () => listeners.delete('imageProgress')
  }),
  onImageKeyCount: vi.fn((cb) => {
    listeners.set('imageKeyCount', cb)
    return () => listeners.delete('imageKeyCount')
  }),
  onImageDone: vi.fn((cb) => {
    listeners.set('imageDone', cb)
    return () => listeners.delete('imageDone')
  }),
  onImagePaused: vi.fn((cb) => {
    listeners.set('imagePaused', cb)
    return () => listeners.delete('imagePaused')
  }),
  onAudioTotal: vi.fn((cb) => {
    listeners.set('audioTotal', cb)
    return () => listeners.delete('audioTotal')
  }),
  onAudioProgress: vi.fn((cb) => {
    listeners.set('audioProgress', cb)
    return () => listeners.delete('audioProgress')
  }),
  onAudioDone: vi.fn((cb) => {
    listeners.set('audioDone', cb)
    return () => listeners.delete('audioDone')
  }),
  onAudioPaused: vi.fn((cb) => {
    listeners.set('audioPaused', cb)
    return () => listeners.delete('audioPaused')
  }),
  compressImage: vi.fn(() => {
    listeners.get('imageTotal')?.(1)
    listeners.get('imageProgress')?.({
      status: 'success',
      file: '/tmp/photo.png',
      backupPath: '/tmp/_tiny_backup/photo.png',
      inputSize: '2 KB',
      outputSize: '1 KB',
      saved: '1 KB',
      format: 'png'
    })
    listeners.get('imageDone')?.({
      total: 1,
      processed: 1,
      skipped: 0,
      failed: 0,
      savedBytes: '1 KB'
    })
    return Promise.resolve()
  }),
  compressAudio: vi.fn(() => Promise.resolve())
}))

vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({
    settings: { taskPreset: 'audit' }
  })
}))

function renderTaskCenter() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TaskCenter />
      </ToastProvider>
    </MemoryRouter>
  )
}

describe('TaskCenter', () => {
  beforeEach(() => {
    listeners.clear()
    localStorage.clear()
  })

  it('renders the unified task entry', () => {
    renderTaskCenter()

    expect(screen.getByText('任务中心')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ 添加文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始统一处理' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /验证优先/ })).toHaveClass('app-card-active')
    expect(screen.getByText(/TinyPNG Key：\d 个已配置/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理 Key' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检查 ffmpeg' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '历史记录' }))
    expect(screen.getByText('暂无任务历史')).toBeInTheDocument()
  })

  it('runs an image task and stores history', async () => {
    renderTaskCenter()

    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('/tmp/photo.png')

    fireEvent.click(screen.getByRole('button', { name: '开始统一处理' }))

    await screen.findByText('photo.png')

    const history = JSON.parse(localStorage.getItem(TASK_HISTORY_KEY))
    expect(history).toHaveLength(1)
    expect(history[0].stats.processed).toBe(1)
  })

  it('shows release health and history filtering controls', () => {
    localStorage.setItem(
      TASK_HISTORY_KEY,
      JSON.stringify([
        {
          id: '1',
          preset: 'balanced',
          finishedAt: '2026-05-29T00:00:00.000Z',
          inputCount: 1,
          stats: { total: 1, processed: 0, skipped: 0, failed: 1 },
          logs: [{ status: 'error', file: '/tmp/broken.png', kind: 'image' }]
        }
      ])
    )

    renderTaskCenter()

    fireEvent.click(screen.getByRole('button', { name: '健康面板' }))
    expect(screen.getByText('发布检查')).toBeInTheDocument()
    expect(screen.getByText('JSON / CSV')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '历史记录' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索历史路径' }), {
      target: { value: 'broken' }
    })
    expect(screen.getByText(/失败 1/)).toBeInTheDocument()
  })
})
