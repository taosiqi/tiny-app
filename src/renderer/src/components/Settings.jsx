import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RuntimeHealthPanel from './RuntimeHealthPanel'
import TinypngKeyManager from './TinypngKeyManager'
import { AppButton, AppCard, AppInput, AppPanel, AppTabs, EmptyState } from './ui/base'
import { CLOSE_BEHAVIOR_OPTIONS, NIGHT_MODE_OPTIONS } from '../settings/themeOptions'
import { useSettings } from '../settings/useSettings'
import { clearTaskHistory, loadTaskHistory } from '../tasks/taskHistory'
import { DEFAULT_TASK_PRESET, TASK_PRESETS } from '../tasks/taskPresets'
import { useToast } from '../toast/useToast'

const TABS = [
  { id: 'general', label: '通用' },
  { id: 'image', label: '图片压缩' },
  { id: 'audio', label: '音频压缩' },
  { id: 'backup', label: '备份与还原' },
  { id: 'history', label: '历史与报告' },
  { id: 'appearance', label: '外观' }
]

function isValidBackupDirName(name) {
  const value = name.trim()
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  )
}

function downloadText(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export default function Settings() {
  const { settings, ready, saveSettings } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'general'
  const toast = useToast()
  const currentBackupDirName = settings.backupDirName ?? '_tiny_backup'
  const [backupDirNameDraft, setBackupDirNameDraft] = useState(null)
  const [historyCount, setHistoryCount] = useState(() => loadTaskHistory().length)
  const backupDirName = backupDirNameDraft ?? currentBackupDirName

  const changeTab = (tab) => {
    setSearchParams(tab === 'general' ? {} : { tab })
  }

  const saveWithToast = async (patch, message) => {
    try {
      await saveSettings(patch)
      toast.success(message)
      return true
    } catch (error) {
      toast.error(`保存失败：${error?.message ?? error}`)
      return false
    }
  }

  const saveBackupDirName = async () => {
    const nextName = backupDirName.trim()
    if (!isValidBackupDirName(nextName)) {
      toast.error('备份目录名不能为空，且不能包含路径分隔符')
      return
    }
    const saved = await saveWithToast({ backupDirName: nextName }, '备份目录名已保存')
    if (saved) setBackupDirNameDraft(null)
  }

  const exportHistory = () => {
    const history = loadTaskHistory()
    if (history.length === 0) {
      toast.warning('暂无任务历史可导出')
      return
    }
    const stamp = new Date().toISOString().replaceAll(':', '-').slice(0, 19)
    downloadText(
      `tinypress-history-${stamp}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), history }, null, 2),
      'application/json;charset=utf-8'
    )
    toast.success('任务历史已导出')
  }

  const clearHistory = () => {
    clearTaskHistory()
    setHistoryCount(0)
    toast.info('已清空任务历史')
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-6 md:px-7">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
            Preferences
          </p>
          <h3 className="mt-1 text-2xl font-black tracking-tight text-stone-950">偏好中心</h3>
          <p className="mt-1 text-sm text-stone-500">集中管理配置、运行状态、备份和任务历史。</p>
        </div>

        <AppPanel className="p-2">
          <AppTabs items={TABS} value={activeTab} onChange={changeTab} className="flex-wrap" />
        </AppPanel>

        {activeTab === 'general' && (
          <div className="space-y-5">
            <AppPanel className="p-6">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
                  Health
                </p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">运行状态</h3>
                <p className="mt-1 text-sm text-stone-500">
                  只展示当前状态；具体配置请使用上方对应页签。
                </p>
              </div>
              <RuntimeHealthPanel />
            </AppPanel>

            <AppPanel className="p-6">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
                  Task Preset
                </p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">
                  默认任务预设
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  任务中心进入时默认选中这里的预设，也可以在任务中心临时切换。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {Object.entries(TASK_PRESETS).map(([id, preset]) => {
                  const active = (settings.taskPreset ?? DEFAULT_TASK_PRESET) === id
                  return (
                    <AppCard
                      key={id}
                      as="button"
                      type="button"
                      disabled={!ready}
                      active={active}
                      onClick={() =>
                        saveWithToast({ taskPreset: id }, `默认预设已设为${preset.label}`)
                      }
                      className="p-3 text-left transition-all"
                    >
                      <span className="block text-sm font-black">{preset.label}</span>
                      <span className="mt-2 block text-xs leading-5 text-stone-500">
                        {preset.desc}
                      </span>
                    </AppCard>
                  )
                })}
              </div>
            </AppPanel>
          </div>
        )}

        {activeTab === 'image' && (
          <AppPanel className="p-6">
            <TinypngKeyManager title="TinyPNG Key" />
          </AppPanel>
        )}

        {activeTab === 'audio' && (
          <AppPanel className="p-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">Audio</p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">音频压缩</h3>
              <p className="mt-1 text-sm text-stone-500">
                当前版本沿用任务中心里的混合音频策略；ffmpeg 状态在“通用”页签查看。
              </p>
            </div>
          </AppPanel>
        )}

        {activeTab === 'backup' && (
          <AppPanel className="p-6">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">Backup</p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">备份目录</h3>
              <p className="mt-1 text-sm text-stone-500">
                压缩前的原文件会备份到原文件同级的这个目录中。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <AppInput
                type="text"
                value={backupDirName}
                disabled={!ready}
                onChange={(event) => setBackupDirNameDraft(event.target.value)}
                className="min-w-0 flex-1 font-mono text-sm"
                aria-label="备份目录名"
              />
              <AppButton
                type="button"
                disabled={!ready || backupDirName.trim() === currentBackupDirName}
                onClick={saveBackupDirName}
                variant="primary"
                className="px-4 py-2 text-sm"
              >
                保存
              </AppButton>
            </div>
          </AppPanel>
        )}

        {activeTab === 'history' && (
          <AppPanel className="p-6">
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
                History
              </p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">历史与报告</h3>
              <p className="mt-1 text-sm text-stone-500">导出或清理任务中心保留的最近处理记录。</p>
            </div>
            {historyCount === 0 ? (
              <EmptyState>暂无任务历史</EmptyState>
            ) : (
              <AppCard className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="text-sm text-stone-600">当前保存 {historyCount} 条任务历史</span>
                <div className="flex gap-2">
                  <AppButton
                    type="button"
                    variant="primary"
                    onClick={exportHistory}
                    className="px-3 py-1.5 text-xs"
                  >
                    导出历史
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="danger"
                    onClick={clearHistory}
                    className="px-3 py-1.5 text-xs"
                  >
                    清空历史
                  </AppButton>
                </div>
              </AppCard>
            )}
          </AppPanel>
        )}

        {activeTab === 'appearance' && (
          <div className="space-y-5">
            <AppPanel className="p-6">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
                  Appearance
                </p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">夜间模式</h3>
                <p className="mt-1 text-sm text-stone-500">选择夜间、白天，或跟随系统自动切换。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {NIGHT_MODE_OPTIONS.map((option) => {
                  const active = settings.nightMode === option.id
                  return (
                    <AppCard
                      key={option.id}
                      as="button"
                      type="button"
                      disabled={!ready}
                      active={active}
                      onClick={() =>
                        saveWithToast({ nightMode: option.id }, `已切换为${option.name}`)
                      }
                      className="p-3 text-left transition-all"
                    >
                      <span className="block text-sm font-black">{option.name}</span>
                      <span className="mt-2 block text-xs leading-5 text-stone-500">
                        {option.desc}
                      </span>
                    </AppCard>
                  )
                })}
              </div>
            </AppPanel>

            <AppPanel className="p-6">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
                  Exit Behavior
                </p>
                <h3 className="mt-1 text-xl font-black tracking-tight text-stone-950">
                  左上角退出行为
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  决定关闭窗口或从系统菜单点“退出”时，TinyPress 是留在后台，还是彻底退出。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {CLOSE_BEHAVIOR_OPTIONS.map((option) => {
                  const active = settings.closeBehavior === option.id
                  return (
                    <AppCard
                      key={option.id}
                      as="button"
                      type="button"
                      disabled={!ready}
                      active={active}
                      onClick={() =>
                        saveWithToast({ closeBehavior: option.id }, `退出行为已设为${option.name}`)
                      }
                      className="p-4 text-left transition-all"
                    >
                      <span className="block text-sm font-black">{option.name}</span>
                      <span className="mt-2 block text-xs leading-5 text-stone-500">
                        {option.desc}
                      </span>
                    </AppCard>
                  )
                })}
              </div>
            </AppPanel>
          </div>
        )}
      </div>
    </div>
  )
}
