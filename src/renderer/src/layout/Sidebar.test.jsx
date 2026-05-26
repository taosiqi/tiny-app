import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from './Sidebar'
import { openExternal } from '../api/desktop'
import { ToastProvider } from '../toast/ToastContext'

vi.mock('../api/desktop', () => ({
  openExternal: vi.fn(async () => {})
}))

describe('Sidebar', () => {
  it('opens a feedback mailto link with the package author email', () => {
    render(
      <ToastProvider>
        <MemoryRouter>
          <Sidebar appVersion="1.2.0" />
        </MemoryRouter>
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: '邮件反馈' }))

    expect(openExternal).toHaveBeenCalledWith(
      expect.stringContaining('mailto:hksiqijson@gmail.com')
    )
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('TinyPress 反馈'))
    )
    expect(openExternal).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('应用版本：1.2.0'))
    )
  })
})
