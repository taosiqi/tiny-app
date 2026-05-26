import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ComparePanel from './ComparePanel'
import { deleteBackupFile, getBackupStatus, restoreFile } from '../api/desktop'

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
    kind: path.endsWith('.png') ? 'image' : 'audio',
    exists: true,
    size: '1 KB',
    bytes: 1024,
    modified: 1700000000,
    image: path.endsWith('.png') ? { width: 100, height: 80 } : null,
    audio: path.endsWith('.mp3') ? { duration: '00:00:01', codec: 'mp3' } : null
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
  },
  {
    status: 'success',
    file: '/tmp/audio.mp3',
    backupPath: '/tmp/_tiny_backup/audio.mp3',
    inputBytes: 4096,
    outputBytes: 2048,
    inputSize: '4 KB',
    outputSize: '2 KB',
    saved: '2 KB'
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  getBackupStatus.mockImplementation(async ({ originalPath, backupPath }) => ({
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
  }))
})

describe('ComparePanel', () => {
  it('filters compare results by file type', async () => {
    render(<ComparePanel logs={logs} />)

    expect(screen.getAllByText('photo.png').length).toBeGreaterThan(0)
    expect(screen.getAllByText('audio.mp3').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '图片' }))

    expect(screen.getAllByText('photo.png').length).toBeGreaterThan(0)
    expect(screen.queryByText('audio.mp3')).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getAllByText(/尺寸/).length).toBeGreaterThan(0))
  })

  it('deletes the selected backup and disables backup actions', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    getBackupStatus.mockResolvedValueOnce({
      originalPath: '/tmp/photo.png',
      backupPath: '/tmp/_tiny_backup/photo.png',
      originalExists: true,
      backupExists: true,
      originalSize: '1 KB',
      backupSize: '2 KB',
      originalBytes: 1024,
      backupBytes: 2048,
      originalModified: 1700000000,
      backupModified: 1700000000
    })
    getBackupStatus.mockResolvedValueOnce({
      originalPath: '/tmp/audio.mp3',
      backupPath: '/tmp/_tiny_backup/audio.mp3',
      originalExists: true,
      backupExists: true,
      originalSize: '2 KB',
      backupSize: '4 KB',
      originalBytes: 2048,
      backupBytes: 4096,
      originalModified: 1700000000,
      backupModified: 1700000000
    })
    getBackupStatus.mockResolvedValueOnce({
      originalPath: '/tmp/photo.png',
      backupPath: '/tmp/_tiny_backup/photo.png',
      originalExists: true,
      backupExists: false,
      originalSize: '1 KB',
      backupSize: null,
      originalBytes: 1024,
      backupBytes: null,
      originalModified: 1700000000,
      backupModified: null
    })

    render(<ComparePanel logs={logs} />)

    fireEvent.click(screen.getByRole('button', { name: /photo\.png/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '删除备份' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '删除备份' }))

    await waitFor(() =>
      expect(deleteBackupFile).toHaveBeenCalledWith('/tmp/_tiny_backup/photo.png', '/tmp/photo.png')
    )
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: '备份缺失' }).length).toBeGreaterThanOrEqual(2)
    )
    expect(screen.getAllByRole('button', { name: '备份缺失' })[0]).toBeDisabled()
    confirmSpy.mockRestore()
  })

  it('restores the selected backup and updates current status', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    getBackupStatus.mockResolvedValue({
      originalPath: '/tmp/photo.png',
      backupPath: '/tmp/_tiny_backup/photo.png',
      originalExists: true,
      backupExists: true,
      originalSize: '2 KB',
      backupSize: '2 KB',
      originalBytes: 2048,
      backupBytes: 2048,
      originalModified: 1700000000,
      backupModified: 1700000000
    })

    render(<ComparePanel logs={logs} />)

    fireEvent.click(screen.getByRole('button', { name: /photo\.png/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '还原' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '还原' }))

    await waitFor(() =>
      expect(restoreFile).toHaveBeenCalledWith('/tmp/_tiny_backup/photo.png', '/tmp/photo.png')
    )
    expect(await screen.findByRole('button', { name: '已还原' })).toBeDisabled()
    confirmSpy.mockRestore()
  })

  it('disables backup actions when the selected backup is missing', async () => {
    getBackupStatus.mockResolvedValue({
      originalPath: '/tmp/photo.png',
      backupPath: '/tmp/_tiny_backup/photo.png',
      originalExists: true,
      backupExists: false,
      originalSize: '1 KB',
      backupSize: null,
      originalBytes: 1024,
      backupBytes: null,
      originalModified: 1700000000,
      backupModified: null
    })

    render(<ComparePanel logs={[logs[0]]} />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: '备份缺失' })).toHaveLength(2))
    expect(screen.getAllByRole('button', { name: '备份缺失' })[0]).toBeDisabled()
    expect(screen.getAllByRole('button', { name: '备份缺失' })[1]).toBeDisabled()
  })
})
