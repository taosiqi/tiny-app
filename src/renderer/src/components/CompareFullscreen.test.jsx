import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompareFullscreen from './CompareFullscreen'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path) => `asset://${path}`
}))

vi.mock('../api/desktop', () => ({
  getBackupStatus: vi.fn(async ({ originalPath, backupPath }) => ({
    originalPath,
    backupPath,
    originalExists: true,
    backupExists: true,
    originalSize: '1 KB',
    backupSize: '2 KB',
    originalBytes: 1024,
    backupBytes: 2048,
    originalModified: 1700000000,
    backupModified: 1700000000
  })),
  getFileMetadata: vi.fn(async (path) => ({
    path,
    name: path.split('/').pop(),
    kind: 'image',
    exists: true,
    size: '1 KB',
    bytes: 1024,
    modified: 1700000000,
    image: { width: 100, height: 80 },
    audio: null
  })),
  deleteBackupFile: vi.fn(async () => {}),
  openInFinder: vi.fn(),
  restoreFile: vi.fn()
}))

const logs = [
  {
    status: 'success',
    file: '/tmp/photo.png',
    backupPath: '/tmp/_tiny_backup/photo.png',
    inputBytes: 2048,
    outputBytes: 1024,
    inputSize: '2 KB',
    outputSize: '1 KB',
    saved: '1 KB'
  }
]

describe('CompareFullscreen', () => {
  it('renders a full compare workspace and closes from the button', () => {
    const onClose = vi.fn()
    render(<CompareFullscreen logs={logs} onClose={onClose} />)

    expect(screen.getByRole('heading', { name: /压缩对比/ })).toBeInTheDocument()
    expect(screen.getByText('成功记录 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭' }))

    expect(onClose).toHaveBeenCalled()
  })
})
