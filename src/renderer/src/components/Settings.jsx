import { useState } from 'react'
import PropTypes from 'prop-types'
import { useSearchParams } from 'react-router-dom'
import TinypngKeyManager from './TinypngKeyManager'
import { AppButton, AppCard, AppInput, AppPanel, AppSelect, AppTabs } from './ui/base'
import { CLOSE_BEHAVIOR_OPTIONS, NIGHT_MODE_OPTIONS } from '../settings/themeOptions'
import { useSettings } from '../settings/useSettings'
import {
  DEFAULT_COMPRESSION_PRESETS,
  DEFAULT_PRESET_ID,
  PRESET_IDS,
  PRESET_META
} from '../tasks/taskPresets'
import { useToast } from '../toast/useToast'

const TABS = [
  { id: 'general', label: '通用' },
  { id: 'presets', label: '压缩预设' },
  { id: 'image', label: '图片压缩' },
  { id: 'backup', label: '备份与还原' },
  { id: 'appearance', label: '外观' }
]

const AUDIO_FORMAT_OPTIONS = [
  ['mixed', '自动识别'],
  ['mp3', '仅 MP3'],
  ['ogg', '仅 OGG'],
  ['wav', '仅 WAV']
]

const AUDIO_QUALITY_OPTIONS = [
  ['low', '低体积'],
  ['medium', '均衡'],
  ['high', '高质量']
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

export default function Settings() {
  const { settings, ready, saveSettings } = useSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab'))
    ? searchParams.get('tab')
    : 'general'
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

  const updatePreset = (id, patch) => {
    const next = {
      ...(settings.compressionPresets ?? DEFAULT_COMPRESSION_PRESETS),
      [id]: {
        ...DEFAULT_COMPRESSION_PRESETS[id],
        ...(settings.compressionPresets?.[id] ?? {}),
        ...patch
      }
    }
    saveWithToast({ compressionPresets: next }, `${PRESET_META[id].label}预设已保存`)
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
    <div className="h-full overflow-y-auto px-5 py-6 md:px-7">
      <div className="mx-auto max-w-5xl space-y-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-stone-400">
            Preferences
          </p>
          <h3 className="mt-1 text-2xl font-black tracking-tight text-stone-950">首选项</h3>
          <p className="mt-1 text-sm text-stone-500">集中管理压缩预设、Key、备份和界面外观。</p>
        </div>

        <AppPanel className="p-2">
          <AppTabs
            items={TABS}
            value={activeTab}
            onChange={(tab) => setSearchParams(tab === 'general' ? {} : { tab })}
            className="flex-wrap"
          />
        </AppPanel>

        {activeTab === 'general' && (
          <AppPanel className="p-6">
            <h3 className="text-xl font-black tracking-tight text-stone-950">通用</h3>
            <p className="mt-1 text-sm text-stone-500">常用压缩参数在“压缩预设”中统一设置。</p>
          </AppPanel>
        )}

        {activeTab === 'presets' && (
          <div className="space-y-4">
            <AppPanel className="p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black tracking-tight text-stone-950">压缩预设</h3>
                  <p className="mt-1 text-sm text-stone-500">
                    三个预设会真实影响目录扫描和 ffmpeg 压缩参数。
                  </p>
                </div>
                <label className="text-xs font-bold text-stone-600">
                  默认预设
                  <AppSelect
                    aria-label="默认预设"
                    value={settings.defaultPresetId ?? DEFAULT_PRESET_ID}
                    disabled={!ready}
                    onChange={(event) =>
                      saveWithToast({ defaultPresetId: event.target.value }, '默认预设已保存')
                    }
                    className="ml-2 py-1.5 text-xs"
                  >
                    {PRESET_IDS.map((id) => (
                      <option key={id} value={id}>
                        {PRESET_META[id].label}
                      </option>
                    ))}
                  </AppSelect>
                </label>
              </div>
            </AppPanel>

            {PRESET_IDS.map((id) => {
              const preset = {
                ...DEFAULT_COMPRESSION_PRESETS[id],
                ...(settings.compressionPresets?.[id] ?? {})
              }
              return (
                <AppPanel key={id} className="p-5">
                  <h4 className="text-sm font-black text-stone-900">{PRESET_META[id].label}</h4>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="text-xs font-bold text-stone-600">
                      音频格式
                      <AppSelect
                        aria-label={`${PRESET_META[id].label}音频格式`}
                        value={preset.audioFormat}
                        disabled={!ready}
                        onChange={(event) => updatePreset(id, { audioFormat: event.target.value })}
                        className="mt-2 w-full"
                      >
                        {AUDIO_FORMAT_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="text-xs font-bold text-stone-600">
                      音频质量
                      <AppSelect
                        aria-label={`${PRESET_META[id].label}音频质量`}
                        value={preset.audioQuality}
                        disabled={!ready}
                        onChange={(event) => updatePreset(id, { audioQuality: event.target.value })}
                        className="mt-2 w-full"
                      >
                        {AUDIO_QUALITY_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label className="flex items-center gap-2 self-end pb-2 text-xs font-bold text-stone-600">
                      <input
                        type="checkbox"
                        checked={preset.recursiveScan}
                        disabled={!ready}
                        onChange={(event) =>
                          updatePreset(id, { recursiveScan: event.target.checked })
                        }
                      />
                      递归扫描子目录
                    </label>
                  </div>
                </AppPanel>
              )
            })}
          </div>
        )}

        {activeTab === 'image' && (
          <AppPanel className="p-6">
            <TinypngKeyManager title="TinyPNG Key" />
          </AppPanel>
        )}

        {activeTab === 'backup' && (
          <AppPanel className="p-6">
            <h3 className="text-xl font-black tracking-tight text-stone-950">备份目录</h3>
            <p className="mt-1 text-sm text-stone-500">
              压缩前的原文件会备份到原文件同级的这个目录中。
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <AppInput
                value={backupDirName}
                disabled={!ready}
                onChange={(event) => setBackupDirNameDraft(event.target.value)}
                aria-label="备份目录名"
                className="min-w-0 flex-1 font-mono text-sm"
              />
              <AppButton
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

        {activeTab === 'appearance' && (
          <div className="space-y-5">
            <PreferenceCards
              title="夜间模式"
              options={NIGHT_MODE_OPTIONS}
              value={settings.nightMode}
              disabled={!ready}
              onChange={(id, name) => saveWithToast({ nightMode: id }, `已切换为${name}`)}
            />
            <PreferenceCards
              title="左上角退出行为"
              options={CLOSE_BEHAVIOR_OPTIONS}
              value={settings.closeBehavior}
              disabled={!ready}
              onChange={(id, name) => saveWithToast({ closeBehavior: id }, `退出行为已设为${name}`)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function PreferenceCards({ title, options, value, disabled, onChange }) {
  return (
    <AppPanel className="p-6">
      <h3 className="text-xl font-black tracking-tight text-stone-950">{title}</h3>
      <div
        className={`mt-5 grid gap-3 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
      >
        {options.map((option) => (
          <AppCard
            key={option.id}
            as="button"
            type="button"
            disabled={disabled}
            active={value === option.id}
            onClick={() => onChange(option.id, option.name)}
            className="p-4 text-left"
          >
            <span className="block text-sm font-black">{option.name}</span>
            <span className="mt-2 block text-xs leading-5 text-stone-500">{option.desc}</span>
          </AppCard>
        ))}
      </div>
    </AppPanel>
  )
}

PreferenceCards.propTypes = {
  title: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      desc: PropTypes.string.isRequired
    })
  ).isRequired,
  value: PropTypes.string,
  disabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired
}
