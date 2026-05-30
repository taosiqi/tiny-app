import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PathPickerPanel from './PathPickerPanel'

const openFiles = vi.fn(async () => ['/tmp/a.png', '/tmp/a.png', '/tmp/b.png'])

vi.mock('../api/desktop', () => ({
  openDirectories: vi.fn(async () => []),
  openFiles: (...args) => openFiles(...args)
}))

describe('PathPickerPanel', () => {
  it('merges selected paths without duplicates', async () => {
    const onChange = vi.fn()
    render(
      <PathPickerPanel
        paths={['/tmp/a.png']}
        running={false}
        emptyText="暂无文件"
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '+ 添加文件' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['/tmp/a.png', '/tmp/b.png']))
  })
})
