import PropTypes from 'prop-types'

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}

export function AppPanel({ as: Component = 'section', className = '', children, ...props }) {
  return (
    <Component className={cx('app-panel rounded-3xl border', className)} {...props}>
      {children}
    </Component>
  )
}

AppPanel.propTypes = {
  as: PropTypes.elementType,
  className: PropTypes.string,
  children: PropTypes.node
}

export function AppCard({
  as: Component = 'div',
  active = false,
  className = '',
  children,
  ...props
}) {
  return (
    <Component
      className={cx('app-card rounded-2xl border', active && 'app-card-active', className)}
      {...props}
    >
      {children}
    </Component>
  )
}

AppCard.propTypes = {
  as: PropTypes.elementType,
  active: PropTypes.bool,
  className: PropTypes.string,
  children: PropTypes.node
}

export function AppButton({ variant = 'secondary', className = '', children, ...props }) {
  return (
    <button className={cx('app-button rounded-2xl', `app-button-${variant}`, className)} {...props}>
      {children}
    </button>
  )
}

AppButton.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary', 'danger', 'ghost']),
  className: PropTypes.string,
  children: PropTypes.node
}

export function AppTabs({ items, value, onChange, className = '' }) {
  return (
    <div className={cx('app-tabs flex gap-1', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cx(
            'app-tab rounded-2xl px-3 py-1.5 text-xs',
            value === item.id && 'app-tab-active'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

AppTabs.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.node.isRequired
    })
  ).isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  className: PropTypes.string
}

export function AppInput({ className = '', ...props }) {
  return (
    <input
      className={cx('app-input rounded-2xl border px-3 py-2 outline-none', className)}
      {...props}
    />
  )
}

AppInput.propTypes = { className: PropTypes.string }

export function AppSelect({ className = '', children, ...props }) {
  return (
    <select
      className={cx('app-input rounded-2xl border px-3 py-2 outline-none', className)}
      {...props}
    >
      {children}
    </select>
  )
}

AppSelect.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node
}

export function AppSelectField({ label, error, className = '', selectClassName = '', children, ...props }) {
  return (
    <label className={cx('app-select-field text-xs font-bold text-stone-600', className)}>
      <span>{label}</span>
      <span className="app-select-wrap mt-2 block">
        <AppSelect className={cx('w-full pr-9', selectClassName)} {...props}>
          {children}
        </AppSelect>
      </span>
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  )
}

AppSelectField.propTypes = {
  label: PropTypes.node.isRequired,
  error: PropTypes.node,
  className: PropTypes.string,
  selectClassName: PropTypes.string,
  children: PropTypes.node
}

export function StatusPill({ tone = 'neutral', className = '', children, ...props }) {
  return (
    <span
      className={cx(
        'status-pill rounded-full px-2 py-0.5 text-xs font-semibold',
        `status-pill-${tone}`,
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

StatusPill.propTypes = {
  tone: PropTypes.oneOf(['success', 'warning', 'error', 'neutral', 'info']),
  className: PropTypes.string,
  children: PropTypes.node
}

export function EmptyState({ children, className = '' }) {
  return (
    <div
      className={cx(
        'empty-state rounded-2xl border border-dashed px-4 py-8 text-center text-sm',
        className
      )}
    >
      {children}
    </div>
  )
}

EmptyState.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string
}
