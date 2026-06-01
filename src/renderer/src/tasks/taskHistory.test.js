import { beforeEach, describe, expect, it } from 'vitest'
import { loadTaskRecords, saveTaskRecords, TASK_RECORDS_KEY, updateTaskRecordStats } from './taskHistory'

describe('task records', () => {
  beforeEach(() => localStorage.clear())

  it('does not read the old history key', () => {
    localStorage.setItem('tinypress_task_records_v5', JSON.stringify([{ id: 'old' }]))
    expect(loadTaskRecords()).toEqual([])
  })

  it('stores at most 30 records', () => {
    saveTaskRecords(Array.from({ length: 35 }, (_, index) => ({ id: `${index}` })))
    expect(JSON.parse(localStorage.getItem(TASK_RECORDS_KEY))).toHaveLength(30)
  })

  it('recalculates live statistics from task logs', () => {
    const record = { stats: { total: 0 }, logs: [] }
    expect(updateTaskRecordStats(record, [
      { status: 'success' },
      { status: 'skipped' },
      { status: 'error' }
    ], 5).stats).toEqual({ total: 5, processed: 1, skipped: 1, failed: 1 })
  })
})
