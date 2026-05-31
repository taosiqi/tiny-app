import { useState } from 'react'
import PropTypes from 'prop-types'
import { openExternal } from '../api/desktop'
import { useToast } from '../toast/useToast'
import { AppButton, AppCard, AppInput, StatusPill } from './ui/base'
import { KEY_LIMIT, useTinypngKeys } from '../tinypng/useTinypngKeys'
import AppConfirmDialog from './ui/AppConfirmDialog'

export function TinypngKeyManagerView({
  controller,
  disabled = false,
  title = 'API Keys',
  description = '每个 TinyPNG Key 每月免费压缩 500 次，可添加多个 Key 自动轮换。'
}) {
  const toast = useToast()
  const { keys, addKey, removeKey, updateKey, checkKey, checkAllKeys, ready } = controller
  const [deleteIndex, setDeleteIndex] = useState(null)
  const deleteKey = deleteIndex === null ? null : keys[deleteIndex]
  const maskedKey = deleteKey?.value ? `...${deleteKey.value.slice(-4)}` : '空 Key'

  const openDeveloperPage = () => {
    openExternal('https://tinify.com/developers').catch((error) =>
      toast.error(`打开申请页面失败：${error?.message ?? error}`)
    )
  }

  return (
    <div className="space-y-3">
      <AppConfirmDialog
        open={deleteIndex !== null}
        title="删除 TinyPNG Key"
        description={`确认删除 ${maskedKey}？删除后无法撤销。`}
        confirmLabel="删除"
        onCancel={() => setDeleteIndex(null)}
        onConfirm={() => {
          removeKey(deleteIndex)
          setDeleteIndex(null)
          toast.success('TinyPNG Key 已删除')
        }}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-stone-800">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-stone-500">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AppButton
            type="button"
            variant="secondary"
            disabled={disabled || !ready || keys.every((key) => !key.value.trim())}
            onClick={checkAllKeys}
            className="px-3 py-1.5 text-xs"
          >
            校验全部
          </AppButton>
          <AppButton
            type="button"
            variant="secondary"
            disabled={disabled || !ready}
            onClick={addKey}
            className="px-3 py-1.5 text-xs"
          >
            + 添加 Key
          </AppButton>
          <AppButton
            type="button"
            variant="ghost"
            onClick={openDeveloperPage}
            className="px-3 py-1.5 text-xs"
          >
            申请
          </AppButton>
        </div>
      </div>

      <div className="space-y-2">
        {keys.map((key, index) => {
          const remaining = KEY_LIMIT - (key.compressionCount ?? 0)
          return (
            <AppCard key={index} className="flex items-center gap-2 px-3 py-2">
              <AppInput
                type="text"
                value={key.value}
                onChange={(event) =>
                  updateKey(index, {
                    value: event.target.value,
                    status: 'idle',
                    compressionCount: null,
                    error: null
                  })
                }
                placeholder="your-api-key"
                disabled={disabled || !ready}
                className="min-w-0 flex-1 font-mono text-xs"
              />
              {key.status === 'valid' && key.compressionCount !== null && (
                <StatusPill
                  tone={remaining <= 50 ? 'warning' : 'success'}
                  className="shrink-0 tabular-nums"
                >
                  {remaining <= 0 ? '已耗尽' : `剩余 ${remaining}`}
                </StatusPill>
              )}
              {key.status === 'invalid' && (
                <span className="max-w-28 shrink-0 truncate text-xs text-red-500" title={key.error}>
                  {key.error}
                </span>
              )}
              {key.status === 'valid' && key.error && (
                <span className="shrink-0 text-xs text-orange-500">{key.error}</span>
              )}
              <AppButton
                type="button"
                variant="primary"
                onClick={(event) => {
                  const input = event.currentTarget.parentElement?.querySelector('input')
                  checkKey(index, input?.value ?? key.value)
                }}
                disabled={disabled || !ready || !key.value.trim() || key.status === 'checking'}
                className="h-8 w-14 shrink-0 px-2 text-xs"
              >
                {key.status === 'checking' ? '...' : '验证'}
              </AppButton>
              <AppButton
                type="button"
                variant="danger"
                onClick={() => setDeleteIndex(index)}
                disabled={disabled || !ready}
                className="h-8 w-14 shrink-0 px-2 text-xs"
              >
                删除
              </AppButton>
            </AppCard>
          )
        })}
      </div>
    </div>
  )
}

export default function TinypngKeyManager({ autoValidate = false, ...props }) {
  const toast = useToast()
  const controller = useTinypngKeys({
    autoValidate,
    toast
  })

  return <TinypngKeyManagerView {...props} controller={controller} />
}

TinypngKeyManagerView.propTypes = {
  controller: PropTypes.shape({
    keys: PropTypes.array.isRequired,
    addKey: PropTypes.func.isRequired,
    removeKey: PropTypes.func.isRequired,
    updateKey: PropTypes.func.isRequired,
    checkKey: PropTypes.func.isRequired,
    checkAllKeys: PropTypes.func.isRequired,
    ready: PropTypes.bool.isRequired
  }).isRequired,
  disabled: PropTypes.bool,
  title: PropTypes.string,
  description: PropTypes.string
}

TinypngKeyManager.propTypes = {
  disabled: PropTypes.bool,
  autoValidate: PropTypes.bool,
  title: PropTypes.string,
  description: PropTypes.string
}
