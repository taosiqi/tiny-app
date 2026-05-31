import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TaskCenter from './TaskCenter'
import { ToastProvider } from '../toast/ToastContext'
import { TASK_RECORDS_KEY } from '../tasks/taskHistory'

vi.mock('./ComparePanel', () => ({ default: () => <div>ComparePanel</div> }))

function Destination() {
  const location = useLocation()
  return <div>{location.pathname}:{location.state?.retryPaths?.join(',')}</div>
}

function renderPage(initialEntries = ['/tasks']) {
  return render(<MemoryRouter initialEntries={initialEntries}>
    <ToastProvider>
      <TaskCenter />
      <Destination />
    </ToastProvider>
  </MemoryRouter>)
}

function record(logs = []) {
  return {
    id: 'record-1',
    source: 'task-center',
    status: 'error',
    inputCount: logs.length,
    stats: { total: logs.length, processed: 0, skipped: 0, failed: logs.length },
    logs
  }
}

describe('TaskCenter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
  })

  it('renders a full-width records center without unified processing controls', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '任务记录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '结果对比' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ 添加文件' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始统一处理' })).not.toBeInTheDocument()
  })

  it('exports the selected record and reports success', () => {
    localStorage.setItem(TASK_RECORDS_KEY, JSON.stringify([record()]))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }))
    expect(screen.getByText(/已导出 tinypress-record-/)).toBeInTheDocument()
  })

  it('routes failed image items back to the image tool for confirmation', () => {
    localStorage.setItem(TASK_RECORDS_KEY, JSON.stringify([record([{ status: 'error', file: '/tmp/photo.png' }])]))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '重试图片 (1)' }))
    expect(screen.getByText('/png:/tmp/photo.png')).toBeInTheDocument()
  })

  it('splits mixed failures into image and audio retry actions', () => {
    localStorage.setItem(TASK_RECORDS_KEY, JSON.stringify([record([
      { status: 'error', file: '/tmp/photo.jpg' },
      { status: 'error', file: '/tmp/audio.ogg' }
    ])]))
    renderPage()
    expect(screen.getByRole('button', { name: '重试图片 (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试音频 (1)' })).toBeInTheDocument()
  })
})
