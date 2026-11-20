import { describe, it, expect } from 'vitest'
import { fieldsOf, sameFieldValue, todoChanges } from '../../utils/todo-changes'

describe('sameFieldValue', () => {
  it('compares Dates by time', () => {
    expect(sameFieldValue(new Date(2026, 0, 1), new Date(2026, 0, 1))).toBe(true)
    expect(sameFieldValue(new Date(2026, 0, 1), new Date(2026, 0, 2))).toBe(false)
    expect(sameFieldValue(new Date(2026, 0, 1), undefined)).toBe(false)
  })

  it('compares a recurrence rule by value; a missing key equals undefined', () => {
    expect(sameFieldValue({ every: { count: 1, unit: 'm' as const }, originalDayOfMonth: 31 }, { every: { count: 1, unit: 'm' as const }, originalDayOfMonth: 31 })).toBe(true)
    expect(sameFieldValue({ every: { count: 1, unit: 'w' as const } }, { every: { count: 1, unit: 'w' as const }, originalDayOfMonth: undefined })).toBe(true)
    expect(sameFieldValue({ every: { count: 1, unit: 'w' as const } }, { every: { count: 1, unit: 'm' as const } })).toBe(false)
  })
})

describe('todoChanges', () => {
  it('lists changed and removed fields, never id or modifiedAt', () => {
    const prev = { id: 1, title: 'a', notes: 'n', dueDate: new Date(2026, 0, 1), modifiedAt: new Date(1) }
    const next = { id: 1, title: 'b', dueDate: new Date(2026, 0, 1), focus: true, modifiedAt: new Date(2) }
    const changes = todoChanges(prev, next)
    expect(changes).toEqual({ title: 'b', notes: undefined, focus: true })
    expect('notes' in changes).toBe(true)
    expect(fieldsOf(prev, changes)).toEqual({ title: 'a', notes: 'n', focus: undefined })
  })
})
