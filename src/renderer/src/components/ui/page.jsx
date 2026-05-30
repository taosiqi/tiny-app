import PropTypes from 'prop-types'

export function PageLayout({ children, className = '' }) {
  return (
    <div className={`flex h-full flex-col overflow-hidden px-4 py-5 md:px-7 md:py-6 ${className}`}>
      {children}
    </div>
  )
}

PageLayout.propTypes = {
  children: PropTypes.node,
  className: PropTypes.string
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-black text-stone-950">{title}</h2>
        {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

PageHeader.propTypes = {
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  actions: PropTypes.node
}
