export const TASK_RECORDS_KEY = 'tinypress_task_records_v4'

const RECORD_LIMIT = 30

export function loadTaskRecords() {
  try {
    const raw = localStorage.getItem(TASK_RECORDS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTaskRecords(items) {
  const normalized = Array.isArray(items) ? items.slice(0, RECORD_LIMIT) : []
  localStorage.setItem(TASK_RECORDS_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent('tinypress:task-records', { detail: normalized }))
  return normalized
}

export function upsertTaskRecord(record) {
  return saveTaskRecords([record, ...loadTaskRecords().filter((item) => item.id !== record.id)])
}

export function deleteTaskRecord(id) {
  return saveTaskRecords(loadTaskRecords().filter((item) => item.id !== id))
}

export function clearTaskRecords() {
  localStorage.removeItem(TASK_RECORDS_KEY)
  window.dispatchEvent(new CustomEvent('tinypress:task-records', { detail: [] }))
  return []
}

export function createTaskRecord({ source, compressionSnapshot, inputCount }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    status: 'running',
    compressionSnapshot,
    startedAt: new Date().toISOString(),
    inputCount,
    stats: { total: 0, processed: 0, skipped: 0, failed: 0 },
    logs: []
  }
}

export function finishTaskRecord(record, status, stats, logs) {
  return {
    ...record,
    status,
    finishedAt: new Date().toISOString(),
    stats: stats ?? record.stats,
    logs
  }
}

export function updateTaskRecordStats(record, logs = record.logs, total = record.stats.total) {
  return {
    ...record,
    logs,
    stats: {
      total,
      processed: logs.filter((item) => item.status === 'success').length,
      skipped: logs.filter((item) => item.status === 'skipped').length,
      failed: logs.filter((item) => item.status === 'error').length
    }
  }
}
