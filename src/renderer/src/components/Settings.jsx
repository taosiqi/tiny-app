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

const TABS = [
  { id: 'compression', label: '压缩设置' },
  { id: 'image', label: '图片压缩' },
  { id: 'backup', label: '备份与还原' },
  { id: 'appearance', label: '外观' }
]

function isValidBackupDirName(name) {
  const value = name.trim()
  return value.length > 0 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\')
}

export default function Settings() {
  const { settings, ready, saveSettings } = useSettings()
  if (!ready) {
    return (
      <PageLayout className="overflow-y-auto">
        <PageHeader title="首选项" description="集中管理压缩参数、Key、备份和界面外观。" />
        <AppPanel className="p-6 text-sm text-stone-500">正在加载首选项...</AppPanel>
      </PageLayout>
    )
  }
  return <ReadySettings settings={settings} saveSettings={saveSettings} />
}

function ReadySettings({ settings, saveSettings }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab')) ? searchParams.get('tab') : 'compression'
  const [draft, setDraft] = useState(() => cloneCompression(settings.compression))
  const [dirty, setDirty] = useState(false)
  const [backupDirNameDraft, setBackupDirNameDraft] = useState(null)
  const currentBackupDirName = settings.backupDirName ?? '_tiny_backup'
  const backupDirName = backupDirNameDraft ?? currentBackupDirName
  const blocker = useBlocker(dirty)

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
    setSearchParams(tab === 'compression' ? {} : { tab })
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

  return (
    <PageLayout className="overflow-y-auto">
      <div className="space-y-5">
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
              <h4 className="text-sm font-black text-stone-900">目录扫描</h4>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Check label="图片递归扫描子目录" checked={draft.image.recursiveScan} onChange={(value) => patchDraft(['image', 'recursiveScan'], value)} />
                <Check label="音频递归扫描子目录" checked={draft.audio.recursiveScan} onChange={(value) => patchDraft(['audio', 'recursiveScan'], value)} />
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
        {activeTab === 'image' && <AppPanel className="p-6"><TinypngKeyManager title="TinyPNG Key" /></AppPanel>}
        {activeTab === 'backup' && (
          <AppPanel className="p-6">
            <h3 className="text-xl font-black text-stone-950">备份目录</h3>
            <p className="mt-1 text-sm text-stone-500">压缩前的原文件会备份到原文件同级的这个目录中。</p>
            <div className="mt-5 flex gap-3"><AppInput value={backupDirName} onChange={(event) => setBackupDirNameDraft(event.target.value)} aria-label="备份目录名" className="flex-1" /><AppButton variant="primary" onClick={saveBackupDirName} disabled={backupDirName.trim() === currentBackupDirName} className="px-4">保存</AppButton></div>
          </AppPanel>
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
function Select({ label, value, options, onChange }) { return <label className="text-xs font-bold text-stone-600">{label}<AppSelect aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 w-full">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</AppSelect></label> }
function Check({ label, checked, onChange }) { return <label className="flex items-center gap-2 text-xs font-bold text-stone-600"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label> }
function PreferenceCards({ title, options, value, disabled, onChange }) { return <AppPanel className="p-6"><h3 className="text-xl font-black text-stone-950">{title}</h3><div className={`mt-5 grid gap-3 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{options.map((option) => <AppCard key={option.id} as="button" type="button" disabled={disabled} active={value === option.id} onClick={() => onChange(option.id, option.name)} className="p-4 text-left"><span className="block text-sm font-black">{option.name}</span><span className="mt-2 block text-xs leading-5 text-stone-500">{option.desc}</span></AppCard>)}</div></AppPanel> }

AudioSettingsCard.propTypes = { format: PropTypes.string.isRequired, label: PropTypes.string.isRequired, draft: PropTypes.object.isRequired, patchDraft: PropTypes.func.isRequired, bitrates: PropTypes.array }
Select.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired, options: PropTypes.array.isRequired, onChange: PropTypes.func.isRequired }
Check.propTypes = { label: PropTypes.string.isRequired, checked: PropTypes.bool.isRequired, onChange: PropTypes.func.isRequired }
PreferenceCards.propTypes = { title: PropTypes.string.isRequired, options: PropTypes.array.isRequired, value: PropTypes.string, disabled: PropTypes.bool, onChange: PropTypes.func.isRequired }
ReadySettings.propTypes = { settings: PropTypes.object.isRequired, saveSettings: PropTypes.func.isRequired }
