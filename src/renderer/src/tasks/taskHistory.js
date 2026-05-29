export const TASK_HISTORY_KEY = 'tinypress_task_history_v2'

const HISTORY_LIMIT = 30

export function loadTaskHistory() {
  try {
    const raw = localStorage.getItem(TASK_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTaskHistory(items) {
  const normalized = Array.isArray(items) ? items.slice(0, HISTORY_LIMIT) : []
  localStorage.setItem(TASK_HISTORY_KEY, JSON.stringify(normalized))
  return normalized
}

export function addTaskHistory(record) {
  const next = [record, ...loadTaskHistory()].slice(0, HISTORY_LIMIT)
  saveTaskHistory(next)
  return next
}

export function clearTaskHistory() {
  localStorage.removeItem(TASK_HISTORY_KEY)
  return []
}
