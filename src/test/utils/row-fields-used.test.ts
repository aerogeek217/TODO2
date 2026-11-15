import { describe, it, expect } from 'vitest'
import { rowFieldsUsed } from '../../utils/row-fields-used'
import { ALL_ROW_FIELDS } from '../../utils/task-row-columns'

const lookups = (people: number[] = [], tags: number[] = [], notes: number[] = []) => ({
  hasPeople: (id: number) => people.includes(id),
  hasTags: (id: number) => tags.includes(id),
  hasNotes: (t: { id: number }) => notes.includes(t.id),
})

describe('rowFieldsUsed', () => {
  it('no tasks, or bare ones: nothing is used', () => {
    const none = { notes: false, people: false, tags: false, due: false, followup: false, status: false }
    expect(rowFieldsUsed([], lookups())).toEqual(none)
    expect(rowFieldsUsed([{ id: 1 }, { id: 2, statusId: 0 }], lookups())).toEqual(none)
  })

  it('each field is used when any task has it', () => {
    expect(rowFieldsUsed([{ id: 1, dueDate: new Date() }, { id: 2, statusId: 3 }], lookups([2], [], [1]))).toEqual({
      notes: true, people: true, tags: false, due: true, followup: false, status: true,
    })
  })

  it('every field: the shared all-fields set', () => {
    const todos = [{ id: 1, dueDate: new Date(), nextFollowupAt: new Date(), statusId: 2 }]
    expect(rowFieldsUsed(todos, lookups([1], [1], [1]))).toBe(ALL_ROW_FIELDS)
  })
})
