export const TASK_PRESETS = {
  balanced: {
    label: '平衡',
    desc: '保留备份，图片走 TinyPNG，音频使用混合策略'
  },
  compact: {
    label: '最小体积',
    desc: '优先缩小体积，适合批量交付前清理'
  },
  audit: {
    label: '验证优先',
    desc: '执行后保留完整结果，便于逐项对比'
  }
}

export const DEFAULT_TASK_PRESET = 'balanced'
