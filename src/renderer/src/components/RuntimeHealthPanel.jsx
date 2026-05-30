import { useEffect, useState } from 'react'
import { getRuntimeHealth } from '../api/desktop'
import { loadTaskHistory } from '../tasks/taskHistory'
import { AppCard, StatusPill } from './ui/base'

export default function RuntimeHealthPanel() {
  const [health, setHealth] = useState(null)
  const [failedTasks] = useState(
    () => loadTaskHistory().filter((item) => (item.stats?.failed ?? 0) > 0).length
  )

  useEffect(() => {
    let active = true
    getRuntimeHealth()
      .then((next) => {
        if (active) setHealth(next)
      })
      .catch(() => {
        if (active) setHealth(null)
      })
    return () => {
      active = false
    }
  }, [])

  const ffmpegOk = health?.ffmpegAvailable

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <AppCard className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-stone-600">TinyPNG Key</span>
            <StatusPill tone={(health?.tinypngKeyCount ?? 0) > 0 ? 'success' : 'warning'}>
              {(health?.tinypngKeyCount ?? 0) > 0 ? '已配置' : '未配置'}
            </StatusPill>
          </div>
          <span className="mt-2 block text-2xl font-black text-stone-950">
            {health?.tinypngKeyCount ?? 0}
          </span>
          <span className="mt-2 block text-xs text-stone-500">实际管理入口在“图片压缩”页签。</span>
        </AppCard>

        <AppCard className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-stone-600">音频引擎</span>
            <StatusPill tone={ffmpegOk ? 'success' : 'error'}>
              {ffmpegOk ? '可用' : '需检查'}
            </StatusPill>
          </div>
          <span
            className="mt-2 block truncate font-mono text-xs text-stone-700"
            title={health?.ffmpegPath}
          >
            {health?.ffmpegPath ?? '检测中...'}
          </span>
          <span className="mt-2 block text-xs text-stone-500">
            {health?.ffmpegExists ? '路径存在' : '未找到本地 ffmpeg 文件'}
          </span>
        </AppCard>

        <AppCard className="px-4 py-3">
          <span className="block text-xs font-semibold text-stone-600">备份目录</span>
          <span className="mt-2 block font-mono text-lg font-black text-stone-950">
            {health?.backupDirName ?? '_tiny_backup'}
          </span>
          <span className="mt-2 block text-xs text-stone-500">目录配置在“备份与还原”页签。</span>
        </AppCard>

        <AppCard className="px-4 py-3">
          <span className="block text-xs font-semibold text-stone-600">最近失败任务</span>
          <span className="mt-2 block text-2xl font-black text-stone-950">{failedTasks}</span>
          <span className="mt-2 block text-xs text-stone-500">详细记录在“历史与报告”页签。</span>
        </AppCard>
      </div>
    </div>
  )
}
