import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FileCompare from './FileCompare'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path) => `asset://${path}`
}))

vi.mock('../api/desktop', () => ({
  compareFiles: vi.fn(),
  openFiles: vi.fn(),
  openInFinder: vi.fn()
}))

describe('FileCompare', () => {
  it('renders the initial empty compare state', () => {
    render(<FileCompare />)

    expect(screen.getByText('文件 A')).toBeInTheDocument()
    expect(screen.getByText('文件 B')).toBeInTheDocument()
    expect(screen.getAllByText('尚未选择文件')).toHaveLength(2)
    expect(screen.getByText('选择文件后开始对比')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除全部' })).toBeDisabled()
  })
})
