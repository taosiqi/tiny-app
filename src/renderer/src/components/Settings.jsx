import { CLOSE_BEHAVIOR_OPTIONS, NIGHT_MODE_OPTIONS } from '../settings/themeOptions'
import { useSettings } from '../settings/useSettings'
import { useToast } from '../toast/useToast'

export default function Settings() {
  const { settings, ready, saveSettings } = useSettings()
  const toast = useToast()

  const saveWithToast = async (patch, message) => {
    try {
      await saveSettings(patch)
      toast.success(message)
    } catch (error) {
      toast.error(`保存失败：${error?.message ?? error}`)
    }
  }

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="rounded-3xl border border-white/70 bg-white/72 p-6 shadow-sm shadow-stone-900/5">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">Appearance</p>
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
                  <span className={`mt-2 block text-xs leading-5 ${active ? 'choice-active-desc' : 'text-stone-500'}`}>
                    {option.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-white/70 bg-white/72 p-6 shadow-sm shadow-stone-900/5">
          <div className="mb-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">Exit Behavior</p>
            <h3 className="mt-1 text-2xl font-black tracking-tight text-stone-950">左上角退出行为</h3>
            <p className="mt-1 text-sm text-stone-500">决定关闭窗口或从系统菜单点“退出”时，TinyPress 是留在后台，还是彻底退出。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {CLOSE_BEHAVIOR_OPTIONS.map((option) => {
              const active = settings.closeBehavior === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={!ready}
                  onClick={() => saveWithToast({ closeBehavior: option.id }, `退出行为已设为${option.name}`)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    active
                      ? 'choice-active'
                      : 'interactive-row border-stone-200 bg-white/70 text-stone-600 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="block text-sm font-black">{option.name}</span>
                  <span className={`mt-2 block text-xs leading-5 ${active ? 'choice-active-desc' : 'text-stone-500'}`}>
                    {option.desc}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
