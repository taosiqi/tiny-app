import PropTypes from 'prop-types'
import { openDirectories, openFiles } from '../api/desktop'
import { AppButton, AppCard, AppPanel, EmptyState } from './ui/base'

export default function PathPickerPanel({
  paths,
  running,
  filters = [],
  emptyText,
  onChange,
  footer
}) {
  const mergePaths = (items) => {
    if (items.length > 0) onChange([...new Set([...paths, ...items])])
  }

  return (
    <AppPanel className="shrink-0 p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-stone-700">目标路径</span>
        <div className="flex flex-wrap gap-2">
          <AppButton
            type="button"
            variant="secondary"
            onClick={async () => mergePaths(await openFiles({ filters }))}
            disabled={running}
            className="px-3 py-1.5 text-xs"
          >
            + 添加文件
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            onClick={async () => mergePaths(await openDirectories())}
            disabled={running}
            className="px-3 py-1.5 text-xs"
          >
            + 添加目录
          </AppButton>
        </div>
      </div>

      {paths.length === 0 ? (
        <EmptyState className="py-7">{emptyText}</EmptyState>
      ) : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {paths.map((path) => (
            <AppCard key={path} as="li" className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>
                {path}
              </span>
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => onChange(paths.filter((item) => item !== path))}
                disabled={running}
                className="shrink-0 px-2 py-1 text-xs"
              >
                删除
              </AppButton>
            </AppCard>
          ))}
        </ul>
      )}
      {footer}
    </AppPanel>
  )
}

PathPickerPanel.propTypes = {
  paths: PropTypes.arrayOf(PropTypes.string).isRequired,
  running: PropTypes.bool.isRequired,
  filters: PropTypes.array,
  emptyText: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  footer: PropTypes.node
}
