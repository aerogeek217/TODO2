import { describe, it, expect } from 'vitest'
import { stampAfter, undoStamps } from '../../utils/task-stamps'

const d = (n: number) => new Date(2026, 10, n)

describe('stampAfter', () => {
  it('a new write (a Date): every task gets it', () => {
    expect(stampAfter(d(5), 1, d(1))).toEqual(d(5))
  })

  it('an undo / redo: a listed task moves from before to after only while it holds before', () => {
    const step = new Map([[1, { before: d(1), after: d(5) }]])
    // Compared by time, not identity (a stored row reads back as a new Date).
    expect(stampAfter(step, 1, new Date(d(1).getTime()))).toEqual(d(5))
    // Touched since: its own stamp stays.
    const current = d(7)
    expect(stampAfter(step, 1, current)).toBe(current)
    // Not listed: unchanged.
    expect(stampAfter(step, 2, current)).toBe(current)
  })
})

describe('undoStamps', () => {
  it('inverts each change: after → before', () => {
    const back = undoStamps(new Map([[1, { before: d(1), after: d(5) }]]))
    expect([...back]).toEqual([[1, { before: d(5), after: d(1) }]])
    expect(stampAfter(back, 1, d(5))).toEqual(d(1))
  })
})
