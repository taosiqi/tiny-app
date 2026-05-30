import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCenter from './TaskCenter'
import { ToastProvider } from '../toast/ToastContext'
import { TASK_RECORDS_KEY } from '../tasks/taskHistory'
import { compressImage, openDirectories } from '../api/desktop'

const listeners = new Map()

vi.mock('./ComparePanel', () => ({ default: () => <div>ComparePanel</div> }))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({
    settings: {
      defaultPresetId: 'balanced',
      compressionPresets: { balanced: { recursiveScan: true, audioFormat: 'mixed', audioQuality: 'medium' } }
    }
  })
}))
vi.mock('../api/desktop', () => ({
  getTinypngKeys: vi.fn(() => Promise.resolve([{ value: 'key-a', compressionCount: 10 }])),
  updateTinypngKeys: vi.fn((keys) => Promise.resolve(keys)),
  checkTinypngKey: vi.fn(),
  openFiles: vi.fn(() => Promise.resolve(['/tmp/photo.png'])),
  openDirectories: vi.fn(() => Promise.resolve(['/tmp/assets', '/tmp/assets'])),
  stopAudioCompression: vi.fn(),
  stopImageCompression: vi.fn(),
  onImageTotal: vi.fn((cb) => { listeners.set('imageTotal', cb); return () => {} }),
  onImageProgress: vi.fn((cb) => { listeners.set('imageProgress', cb); return () => {} }),
  onImageKeyCount: vi.fn((cb) => { listeners.set('imageKeyCount', cb); return () => {} }),
  onImageDone: vi.fn((cb) => { listeners.set('imageDone', cb); return () => {} }),
  onImagePaused: vi.fn((cb) => { listeners.set('imagePaused', cb); return () => {} }),
  onAudioTotal: vi.fn((cb) => { listeners.set('audioTotal', cb); return () => {} }),
  onAudioProgress: vi.fn((cb) => { listeners.set('audioProgress', cb); return () => {} }),
  onAudioDone: vi.fn((cb) => { listeners.set('audioDone', cb); return () => {} }),
  onAudioPaused: vi.fn((cb) => { listeners.set('audioPaused', cb); return () => {} }),
  compressAudio: vi.fn(),
  compressImage: vi.fn(() => {
    listeners.get('imageProgress')?.({ status: 'success', file: '/tmp/photo.png', backupPath: '/tmp/_tiny_backup/photo.png' })
    listeners.get('imageDone')?.({ total: 1, processed: 1, skipped: 0, failed: 0, savedBytes: '1 KB' })
    return Promise.resolve()
  })
}))

function renderPage() {
  return render(<MemoryRouter><ToastProvider><TaskCenter /></ToastProvider></MemoryRouter>)
}

describe('TaskCenter', () => {
  beforeEach(() => { localStorage.clear(); listeners.clear(); vi.clearAllMocks() })

  it('renders records without health or footer shortcuts', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '任务记录' })).toBeInTheDocument()
    expect(screen.queryByText('健康面板')).not.toBeInTheDocument()
    expect(screen.queryByText('管理 Key')).not.toBeInTheDocument()
  })

  it('runs an image task and writes the v3 task record', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await screen.findByText('/tmp/photo.png')
    fireEvent.click(screen.getByRole('button', { name: '开始统一处理' }))
    await waitFor(() => expect(compressImage).toHaveBeenCalled())
    const records = JSON.parse(localStorage.getItem(TASK_RECORDS_KEY))
    expect(records[0].source).toBe('task-center')
    expect(records[0].presetId).toBe('balanced')
    expect(records[0].status).toBe('success')
  })

  it('merges selected directories without duplicates', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '+ 添加目录' }))
    await screen.findByText('/tmp/assets')
    expect(openDirectories).toHaveBeenCalled()
    expect(screen.getAllByText('/tmp/assets')).toHaveLength(1)
  })
})
