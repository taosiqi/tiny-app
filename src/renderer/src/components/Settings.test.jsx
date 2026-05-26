import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const saveSettings = vi.fn()

vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({
    settings: { nightMode: 'system', closeBehavior: 'background' },
    ready: true,
    saveSettings
  })
}))

describe('Settings', () => {
  it('saves appearance and close behavior choices', () => {
    render(<Settings />)

    fireEvent.click(screen.getByRole('button', { name: /^夜间/ }))
    fireEvent.click(screen.getByRole('button', { name: /完全退出/ }))

    expect(saveSettings).toHaveBeenCalledWith({ nightMode: 'dark' })
    expect(saveSettings).toHaveBeenCalledWith({ closeBehavior: 'quit' })
  })
})
