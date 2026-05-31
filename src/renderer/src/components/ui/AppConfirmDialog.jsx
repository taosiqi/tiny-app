import PropTypes from 'prop-types'
import { AppButton, AppPanel } from './base'

export default function AppConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'danger',
  onConfirm,
  onCancel
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
      <AppPanel
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        className="w-full max-w-md bg-white p-5 shadow-2xl"
      >
        <h3 id="app-confirm-title" className="text-base font-black text-stone-900">{title}</h3>
        {description && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-stone-600">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <AppButton type="button" variant="secondary" onClick={onCancel} className="px-4 py-2 text-sm">
            {cancelLabel}
          </AppButton>
          <AppButton type="button" variant={tone} onClick={onConfirm} className="px-4 py-2 text-sm">
            {confirmLabel}
          </AppButton>
        </div>
      </AppPanel>
    </div>
  )
}

AppConfirmDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  confirmLabel: PropTypes.string,
  cancelLabel: PropTypes.string,
  tone: PropTypes.oneOf(['primary', 'danger']),
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired
}
