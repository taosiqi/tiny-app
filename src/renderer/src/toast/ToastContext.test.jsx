import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from './ToastContext'
import { useToast } from './useToast'

function ToastHarness() {
  const toast = useToast()
  return (
    <div>
      <button type="button" onClick={() => toast.success('保存成功')}>
        show success
      </button>
      <button type="button" onClick={() => toast.error('保存失败', { duration: 0 })}>
        show error
      </button>
    </div>
  )
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders and closes toast messages', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'show error' }))

    expect(screen.getByText('保存失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.getByText('保存失败')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(screen.queryByText('保存失败')).not.toBeInTheDocument()
  })

  it('removes toast messages automatically after the exit animation', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'show success' }))
    expect(screen.getByText('保存成功')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3300)
    })
    expect(screen.getByText('保存成功')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(screen.queryByText('保存成功')).not.toBeInTheDocument()
  })

  it('keeps persistent toast messages until dismissed', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'show error' }))
    act(() => {
      vi.advanceTimersByTime(10000)
    })

    expect(screen.getByText('保存失败')).toBeInTheDocument()
  })
})
