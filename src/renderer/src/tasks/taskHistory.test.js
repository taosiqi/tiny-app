import { beforeEach, describe, expect, it } from 'vitest'
import { loadTaskRecords, saveTaskRecords, TASK_RECORDS_KEY } from './taskHistory'

describe('task records', () => {
  beforeEach(() => localStorage.clear())

  it('does not read the old history key', () => {
    localStorage.setItem('tinypress_task_history_v2', JSON.stringify([{ id: 'old' }]))
    expect(loadTaskRecords()).toEqual([])
  })

  it('stores at most 30 records', () => {
    saveTaskRecords(Array.from({ length: 35 }, (_, index) => ({ id: `${index}` })))
    expect(JSON.parse(localStorage.getItem(TASK_RECORDS_KEY))).toHaveLength(30)
  })
})
