import { CLOSE_BEHAVIOR_OPTIONS, NIGHT_MODE_OPTIONS } from '../settings/themeOptions'
import { useSettings } from '../settings/useSettings'
import { useToast } from '../toast/useToast'
import { useState } from 'react'

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

export default function Settings() {
  const { settings, ready, saveSettings } = useSettings()
  const toast = useToast()
  const currentBackupDirName = settings.backupDirName ?? '_tiny_backup'
  const [backupDirNameDraft, setBackupDirNameDraft] = useState(null)
  const backupDirName = backupDirNameDraft ?? currentBackupDirName

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

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="rounded-3xl border border-white/70 bg-white/72 p-6 shadow-sm shadow-stone-900/5">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
              Appearance
            </p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-stone-950">夜间模式</h3>
            <p className="mt-1 text-sm text-stone-500">选择夜间、白天，或跟随系统自动切换。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {NIGHT_MODE_OPTIONS.map((option) => {
              const active = settings.nightMode === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!ready}
                  onClick={() => saveWithToast({ nightMode: option.id }, `已切换为${option.name}`)}
                  className={`rounded-2xl border p-3 text-left transition-all ${
                    active
                      ? 'choice-active'
                      : 'interactive-row border-stone-200 bg-white/70 text-stone-600 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="block text-sm font-black">{option.name}</span>
                  <span
                    className={`mt-2 block text-xs leading-5 ${active ? 'choice-active-desc' : 'text-stone-500'}`}
                  >
                    {option.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/72 p-6 shadow-sm shadow-stone-900/5">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
              Exit Behavior
            </p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-stone-950">
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
                <button
                  key={option.id}
                  type="button"
                  disabled={!ready}
                  onClick={() =>
                    saveWithToast({ closeBehavior: option.id }, `退出行为已设为${option.name}`)
                  }
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    active
                      ? 'choice-active'
                      : 'interactive-row border-stone-200 bg-white/70 text-stone-600 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="block text-sm font-black">{option.name}</span>
                  <span
                    className={`mt-2 block text-xs leading-5 ${active ? 'choice-active-desc' : 'text-stone-500'}`}
                  >
                    {option.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/72 p-6 shadow-sm shadow-stone-900/5">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">Backup</p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-stone-950">备份目录</h3>
            <p className="mt-1 text-sm text-stone-500">
              压缩前的原文件会备份到原文件同级的这个目录中。
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={backupDirName}
              disabled={!ready}
              onChange={(event) => setBackupDirNameDraft(event.target.value)}
              className="min-w-0 flex-1 rounded-2xl border border-stone-200 bg-white/70 px-3 py-2 text-sm font-mono text-stone-700 outline-none focus:border-[var(--theme-accent)] disabled:opacity-50"
              aria-label="备份目录名"
            />
            <button
              type="button"
              disabled={!ready || backupDirName.trim() === currentBackupDirName}
              onClick={saveBackupDirName}
              className="interactive-button rounded-2xl bg-sky-100 px-4 py-2 text-sm font-semibold text-stone-950 disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
