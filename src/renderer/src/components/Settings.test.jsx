import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'
import { ToastProvider } from '../toast/ToastContext'

const saveSettings = vi.fn()

vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({
    settings: { nightMode: 'system', closeBehavior: 'background', backupDirName: '_tiny_backup' },
    ready: true,
    saveSettings
  })
}))

describe('Settings', () => {
  beforeEach(() => {
    saveSettings.mockClear()
  })

  it('saves appearance and close behavior choices', () => {
    render(
      <ToastProvider>
        <Settings />
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /^夜间/ }))
    fireEvent.click(screen.getByRole('button', { name: /完全退出/ }))

    expect(saveSettings).toHaveBeenCalledWith({ nightMode: 'dark' })
    expect(saveSettings).toHaveBeenCalledWith({ closeBehavior: 'quit' })
  })

  it('saves valid backup directory names and rejects invalid names', () => {
    render(
      <ToastProvider>
        <Settings />
      </ToastProvider>
    )

    const input = screen.getByRole('textbox', { name: '备份目录名' })
    fireEvent.change(input, { target: { value: 'my_backup' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(saveSettings).toHaveBeenCalledWith({ backupDirName: 'my_backup' })

    saveSettings.mockClear()
    fireEvent.change(input, { target: { value: '../bad' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByText('备份目录名不能为空，且不能包含路径分隔符')).toBeInTheDocument()
  })
})
