import { useContext } from 'react'
import { ToastContext } from './toastStateContext'

const noop = () => null
const fallbackToast = {
  success: noop,
  error: noop,
  warning: noop,
  info: noop,
  dismiss: noop
}

export function useToast() {
  return useContext(ToastContext) ?? fallbackToast
}
