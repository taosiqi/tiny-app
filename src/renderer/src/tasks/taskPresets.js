export const PRESET_IDS = ['compact', 'balanced', 'quality']

export const PRESET_META = {
  compact: { label: '省空间' },
  balanced: { label: '平衡' },
  quality: { label: '高质量' }
}

export const DEFAULT_PRESET_ID = 'balanced'

export const DEFAULT_COMPRESSION_PRESETS = {
  compact: { recursiveScan: true, audioFormat: 'mixed', audioQuality: 'low' },
  balanced: { recursiveScan: true, audioFormat: 'mixed', audioQuality: 'medium' },
  quality: { recursiveScan: true, audioFormat: 'mixed', audioQuality: 'high' }
}

export function getPreset(settings, presetId = settings.defaultPresetId) {
  const id = PRESET_IDS.includes(presetId) ? presetId : DEFAULT_PRESET_ID
  return {
    id,
    ...DEFAULT_COMPRESSION_PRESETS[id],
    ...(settings.compressionPresets?.[id] ?? {})
  }
}
