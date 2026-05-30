export const TASK_RECORDS_KEY = 'tinypress_task_records_v3'
export const TASK_HISTORY_KEY = TASK_RECORDS_KEY

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

export function createTaskRecord({ source, presetId, presetSnapshot, inputCount }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    status: 'running',
    presetId,
    presetSnapshot,
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

// Transitional aliases for internal callers while pages migrate to the v3 record model.
export const loadTaskHistory = loadTaskRecords
export const saveTaskHistory = saveTaskRecords
export const addTaskHistory = upsertTaskRecord
export const clearTaskHistory = clearTaskRecords
