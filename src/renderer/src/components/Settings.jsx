import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { useBlocker, useSearchParams } from 'react-router-dom'
import TinypngKeyManager from './TinypngKeyManager'
import { AppButton, AppCard, AppInput, AppPanel, AppSelect, AppTabs } from './ui/base'
import { CLOSE_BEHAVIOR_OPTIONS, NIGHT_MODE_OPTIONS } from '../settings/themeOptions'
import { useSettings } from '../settings/useSettings'
import {
  CHANNEL_OPTIONS,
  cloneCompression,
  COMPRESSION_PROFILES,
  formatSampleRate,
  MP3_BITRATES,
  OGG_BITRATES,
  SAMPLE_RATES
} from '../settings/compressionSettings'
import { useToast } from '../toast/useToast'
import { PageHeader, PageLayout } from './ui/page'
import AppConfirmDialog from './ui/AppConfirmDialog'
import {
  chooseSettingsExportFile,
  chooseSettingsImportFile,
  exportAppSettings,
  importAppSettings
} from '../api/desktop'

const TABS = [
  { id: 'appearance', label: '外观' },
  { id: 'compression', label: '压缩设置' },
  { id: 'image', label: '图片压缩' },
  { id: 'backup', label: '备份与还原' }
]

function isValidBackupDirName(name) {
  const value = name.trim()
  return value.length > 0 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

export default function Settings() {
  const { settings, ready, saveSettings, replaceSettings } = useSettings()
  if (!ready) {
    return (
      <PageLayout className="overflow-y-auto">
        <PageHeader title="首选项" description="集中管理压缩参数、Key、备份和界面外观。" />
        <AppPanel className="p-6 text-sm text-stone-500">正在加载首选项...</AppPanel>
      </PageLayout>
    )
  }
  return <ReadySettings settings={settings} saveSettings={saveSettings} replaceSettings={replaceSettings} />
}

function ReadySettings({ settings, saveSettings, replaceSettings }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab')) ? searchParams.get('tab') : 'appearance'
  const [draft, setDraft] = useState(() => cloneCompression(settings.compression))
  const [dirty, setDirty] = useState(false)
  const [backupDirNameDraft, setBackupDirNameDraft] = useState(null)
  const currentBackupDirName = settings.backupDirName ?? '_tiny_backup'
  const backupDirName = backupDirNameDraft ?? currentBackupDirName
  const blocker = useBlocker(dirty)
  const [configAction, setConfigAction] = useState(null)

  useEffect(() => {
    const guard = (event) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('压缩设置尚未保存，确认离开吗？')) blocker.proceed()
    else blocker.reset()
  }, [blocker])

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

  const changeTab = (tab) => {
    if (dirty && !window.confirm('压缩设置尚未保存，确认切换页签并放弃修改吗？')) return
    if (dirty) {
      setDraft(cloneCompression(settings.compression))
      setDirty(false)
    }
    setSearchParams(tab === 'appearance' ? {} : { tab })
  }

  const patchDraft = (path, value) => {
    setDraft((current) => {
      const next = cloneCompression(current)
      let target = next
      for (const key of path.slice(0, -1)) target = target[key]
      target[path.at(-1)] = value
      return next
    })
    setDirty(true)
  }

  const saveCompression = async () => {
    if (await saveWithToast({ compression: draft }, '压缩设置已保存')) setDirty(false)
  }

  const saveBackupDirName = async () => {
    const nextName = backupDirName.trim()
    if (!isValidBackupDirName(nextName)) return toast.error('备份目录名不能为空，且不能包含路径分隔符')
    if (await saveWithToast({ backupDirName: nextName }, '备份目录名已保存')) setBackupDirNameDraft(null)
  }

  const runConfigAction = async () => {
    const action = configAction
    setConfigAction(null)
    if (!action) return
    if (dirty && !window.confirm('压缩设置尚未保存，确认放弃修改吗？')) return
    try {
      if (action === 'export') {
        const targetPath = await chooseSettingsExportFile()
        if (!targetPath) return
        await exportAppSettings(targetPath)
        toast.success('配置文件已导出')
        return
      }
      const sourcePath = await chooseSettingsImportFile()
      if (!sourcePath) return
      const imported = await importAppSettings(sourcePath)
      replaceSettings(imported)
      setDraft(cloneCompression(imported.compression))
      setDirty(false)
      setBackupDirNameDraft(null)
      window.dispatchEvent(new CustomEvent('tinypress:keys-updated', { detail: { source: 'settings-import', keys: imported.tinypngKeys ?? [] } }))
      toast.success('配置文件已导入')
    } catch (error) {
      toast.error(`${action === 'export' ? '导出' : '导入'}失败：${error?.message ?? error}`)
    }
  }

  return (
    <PageLayout className="overflow-y-auto">
      <div className="space-y-5">
        <AppConfirmDialog
          open={configAction !== null}
          title={configAction === 'export' ? '导出完整配置' : '导入并覆盖配置'}
          description={configAction === 'export' ? '配置文件将包含明文 TinyPNG Key。请妥善保管，不要公开分享。' : '导入会覆盖当前外观、压缩、备份和 TinyPNG Key 设置。配置文件包含明文敏感 Key，确认继续？'}
          confirmLabel={configAction === 'export' ? '继续导出' : '继续导入'}
          tone={configAction === 'export' ? 'primary' : 'danger'}
          onCancel={() => setConfigAction(null)}
          onConfirm={runConfigAction}
        />
        <PageHeader title="首选项" description="集中管理压缩参数、Key、备份和界面外观。" />
        <AppPanel className="p-2"><AppTabs items={TABS} value={activeTab} onChange={changeTab} className="flex-wrap" /></AppPanel>

        {activeTab === 'compression' && (
          <div className="space-y-4">
            <AppPanel className="p-6">
              <h3 className="text-xl font-black text-stone-950">压缩设置</h3>
              <p className="mt-1 text-sm text-stone-500">快捷档位只填充草稿，确认参数后统一保存。</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {Object.entries(COMPRESSION_PROFILES).map(([id, profile]) => (
                  <AppButton key={id} type="button" variant="secondary" onClick={() => { setDraft(cloneCompression(profile)); setDirty(true) }} className="py-2 text-sm">
                    {profile.label}
                  </AppButton>
                ))}
              </div>
            </AppPanel>
            <AppPanel className="p-6">
              <h4 className="text-sm font-black text-stone-900">音频目录扫描</h4>
              <div className="mt-4">
                <Check label="递归扫描音频子目录" checked={draft.audio.recursiveScan} onChange={(value) => patchDraft(['audio', 'recursiveScan'], value)} />
              </div>
            </AppPanel>
            <AudioSettingsCard format="mp3" label="MP3" draft={draft} patchDraft={patchDraft} bitrates={MP3_BITRATES} />
            <AudioSettingsCard format="ogg" label="OGG" draft={draft} patchDraft={patchDraft} bitrates={OGG_BITRATES} />
            <AudioSettingsCard format="wav" label="WAV" draft={draft} patchDraft={patchDraft} />
            <div className="flex justify-end gap-2">
              <AppButton type="button" variant="secondary" disabled={!dirty} onClick={() => { setDraft(cloneCompression(settings.compression)); setDirty(false) }} className="px-4 py-2 text-sm">恢复已保存值</AppButton>
              <AppButton type="button" variant="primary" disabled={!dirty} onClick={saveCompression} className="px-4 py-2 text-sm">保存压缩设置</AppButton>
            </div>
          </div>
        )}
        {activeTab === 'image' && <div className="space-y-4">
          <AppPanel className="p-6">
            <h3 className="text-xl font-black text-stone-950">图片压缩引擎</h3>
            <p className="mt-1 text-sm text-stone-500">自动选择优先使用可用 Tinify Key，额度耗尽后继续使用本地压缩。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                ['auto', '自动选择'],
                ['local', '本地压缩'],
                ['tinify', 'Tinify API']
              ].map(([id, label]) => (
                <AppButton key={id} type="button" variant={draft.image.engine === id ? 'primary' : 'secondary'} onClick={() => patchDraft(['image', 'engine'], id)} className="py-2 text-sm">
                  {label}
                </AppButton>
              ))}
            </div>
            <div className="mt-4"><Check label="递归扫描图片子目录" checked={draft.image.recursiveScan} onChange={(value) => patchDraft(['image', 'recursiveScan'], value)} /></div>
            <div className="mt-4 flex justify-end gap-2">
              <AppButton type="button" variant="secondary" disabled={!dirty} onClick={() => { setDraft(cloneCompression(settings.compression)); setDirty(false) }} className="px-4 py-2 text-sm">恢复已保存值</AppButton>
              <AppButton type="button" variant="primary" disabled={!dirty} onClick={saveCompression} className="px-4 py-2 text-sm">保存图片设置</AppButton>
            </div>
          </AppPanel>
          {draft.image.engine !== 'tinify' && <LocalImageSettingsPanel draft={draft} patchDraft={patchDraft} />}
          {draft.image.engine !== 'local' && <AppPanel className="p-6"><TinypngKeyManager title="TinyPNG Key" /></AppPanel>}
        </div>}
        {activeTab === 'backup' && (
          <div className="space-y-4"><AppPanel className="p-6">
            <h3 className="text-xl font-black text-stone-950">备份目录</h3>
            <p className="mt-1 text-sm text-stone-500">压缩前的原文件会备份到原文件同级的这个目录中。</p>
            <div className="mt-5 flex gap-3"><AppInput value={backupDirName} onChange={(event) => setBackupDirNameDraft(event.target.value)} aria-label="备份目录名" className="flex-1" /><AppButton variant="primary" onClick={saveBackupDirName} disabled={backupDirName.trim() === currentBackupDirName} className="px-4">保存</AppButton></div>
          </AppPanel>
          <AppPanel className="p-6">
            <h3 className="text-xl font-black text-stone-950">配置文件</h3>
            <p className="mt-1 text-sm text-stone-500">导出或恢复完整首选项。配置文件包含明文 TinyPNG Key。</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <AppButton type="button" variant="secondary" onClick={() => setConfigAction('export')} className="px-4 py-2 text-sm">导出配置</AppButton>
              <AppButton type="button" variant="danger" onClick={() => setConfigAction('import')} className="px-4 py-2 text-sm">导入并覆盖</AppButton>
            </div>
          </AppPanel></div>
        )}
        {activeTab === 'appearance' && <div className="space-y-5">
          <PreferenceCards title="夜间模式" options={NIGHT_MODE_OPTIONS} value={settings.nightMode} onChange={(id, name) => saveWithToast({ nightMode: id }, `已切换为${name}`)} />
          <PreferenceCards title="左上角退出行为" options={CLOSE_BEHAVIOR_OPTIONS} value={settings.closeBehavior} onChange={(id, name) => saveWithToast({ closeBehavior: id }, `退出行为已设为${name}`)} />
        </div>}
      </div>
    </PageLayout>
  )
}

function AudioSettingsCard({ format, label, draft, patchDraft, bitrates }) {
  const value = draft.audio[format]
  return <AppPanel className="p-6"><h4 className="text-sm font-black text-stone-900">{label}</h4><div className="mt-4 grid gap-4 sm:grid-cols-3">
    {bitrates && <Select label="码率" value={value.bitrate} options={bitrates.map((item) => [item, item])} onChange={(next) => patchDraft(['audio', format, 'bitrate'], next)} />}
    <Select label="采样率" value={value.sampleRate} options={SAMPLE_RATES.map((item) => [item, formatSampleRate(item)])} onChange={(next) => patchDraft(['audio', format, 'sampleRate'], Number(next))} />
    <Select label="声道" value={value.channels} options={CHANNEL_OPTIONS.map((item) => [item, item === 1 ? '单声道' : '立体声'])} onChange={(next) => patchDraft(['audio', format, 'channels'], Number(next))} />
  </div></AppPanel>
}
function LocalImageSettingsPanel({ draft, patchDraft }) {
  const local = draft.image.local
  const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index)
  const qualities = range(0, 100).map((item) => [item, item])
  return <div className="space-y-4">
    <AppPanel className="p-6"><h4 className="text-sm font-black text-stone-900">PNG</h4><div className="mt-4 grid gap-4 sm:grid-cols-4">
      <Select label="模式" value={local.png.mode} options={[['lossy', '有损量化'], ['lossless', '仅无损优化']]} onChange={(next) => patchDraft(['image', 'local', 'png', 'mode'], next)} />
      <Select label="最低质量" value={local.png.minQuality} options={qualities} onChange={(next) => patchDraft(['image', 'local', 'png', 'minQuality'], Number(next))} />
      <Select label="最高质量" value={local.png.maxQuality} options={qualities} onChange={(next) => patchDraft(['image', 'local', 'png', 'maxQuality'], Number(next))} />
      <NumberInput label="最大颜色数" value={local.png.maxColors} min={2} max={256} onChange={(next) => patchDraft(['image', 'local', 'png', 'maxColors'], next)} />
    </div></AppPanel>
    <AppPanel className="p-6"><h4 className="text-sm font-black text-stone-900">JPEG</h4><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Select label="JPEG 质量" value={local.jpeg.quality} options={qualities} onChange={(next) => patchDraft(['image', 'local', 'jpeg', 'quality'], Number(next))} />
      <Check label="渐进式输出" checked={local.jpeg.progressive} onChange={(next) => patchDraft(['image', 'local', 'jpeg', 'progressive'], next)} />
    </div></AppPanel>
    <AppPanel className="p-6"><h4 className="text-sm font-black text-stone-900">WebP</h4><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Select label="WebP 模式" value={local.webp.mode} options={[['lossy', '有损'], ['lossless', '无损']]} onChange={(next) => patchDraft(['image', 'local', 'webp', 'mode'], next)} />
      <Select label="WebP 质量" value={local.webp.quality} options={qualities} onChange={(next) => patchDraft(['image', 'local', 'webp', 'quality'], Number(next))} />
    </div></AppPanel>
    <AppPanel className="p-6"><h4 className="text-sm font-black text-stone-900">AVIF</h4><div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Select label="AVIF 质量" value={local.avif.quality} options={qualities} onChange={(next) => patchDraft(['image', 'local', 'avif', 'quality'], Number(next))} />
      <Select label="AVIF 编码速度" value={local.avif.speed} options={range(1, 10).map((item) => [item, item])} onChange={(next) => patchDraft(['image', 'local', 'avif', 'speed'], Number(next))} />
    </div></AppPanel>
  </div>
}
function Select({ label, value, options, onChange }) { return <label className="text-xs font-bold text-stone-600">{label}<AppSelect aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</AppSelect></label> }
function NumberInput({ label, value, min, max, onChange }) { return <label className="text-xs font-bold text-stone-600">{label}<AppInput aria-label={label} type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 w-full" /></label> }
function Check({ label, checked, onChange }) { return <label className="flex items-center gap-2 text-xs font-bold text-stone-600"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label> }
function PreferenceCards({ title, options, value, disabled, onChange }) { return <AppPanel className="p-6"><h3 className="text-xl font-black text-stone-950">{title}</h3><div className={`mt-5 grid gap-3 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{options.map((option) => <AppCard key={option.id} as="button" type="button" disabled={disabled} active={value === option.id} onClick={() => onChange(option.id, option.name)} className="p-4 text-left"><span className="block text-sm font-black">{option.name}</span><span className="mt-2 block text-xs leading-5 text-stone-500">{option.desc}</span></AppCard>)}</div></AppPanel> }

AudioSettingsCard.propTypes = { format: PropTypes.string.isRequired, label: PropTypes.string.isRequired, draft: PropTypes.object.isRequired, patchDraft: PropTypes.func.isRequired, bitrates: PropTypes.array }
LocalImageSettingsPanel.propTypes = { draft: PropTypes.object.isRequired, patchDraft: PropTypes.func.isRequired }
Select.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired, options: PropTypes.array.isRequired, onChange: PropTypes.func.isRequired }
NumberInput.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.number.isRequired, min: PropTypes.number.isRequired, max: PropTypes.number.isRequired, onChange: PropTypes.func.isRequired }
Check.propTypes = { label: PropTypes.string.isRequired, checked: PropTypes.bool.isRequired, onChange: PropTypes.func.isRequired }
PreferenceCards.propTypes = { title: PropTypes.string.isRequired, options: PropTypes.array.isRequired, value: PropTypes.string, disabled: PropTypes.bool, onChange: PropTypes.func.isRequired }
ReadySettings.propTypes = { settings: PropTypes.object.isRequired, saveSettings: PropTypes.func.isRequired, replaceSettings: PropTypes.func.isRequired }
