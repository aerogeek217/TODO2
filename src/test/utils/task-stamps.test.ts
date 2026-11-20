import { describe, it, expect } from 'vitest'
import { KEEP_STAMPS, stampAfter, undoStamps, type StampChanges } from '../../utils/task-stamps'

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

describe('KEEP_STAMPS', () => {
  it('lists no task: every task keeps the stamp it holds', () => {
    expect(KEEP_STAMPS.size).toBe(0)
    expect(KEEP_STAMPS).not.toBeInstanceOf(Date)
    const current = d(7)
    expect(stampAfter(KEEP_STAMPS, 1, current)).toBe(current)
    expect(stampAfter(KEEP_STAMPS, 99, current)).toBe(current)
  })

  it('a step made with it puts back what it found: its undo and redo move no stamp either', () => {
    const current = d(7)
    // What a write records: each task from its stamp to the stamp the write left.
    const step: StampChanges = new Map([[1, { before: current, after: stampAfter(KEEP_STAMPS, 1, current) }]])
    expect(stampAfter(undoStamps(step), 1, current)).toBe(current)
    expect(stampAfter(step, 1, current)).toBe(current)
    // Touched since: the newer stamp stays.
    const newer = d(9)
    expect(stampAfter(undoStamps(step), 1, newer)).toBe(newer)
    expect(stampAfter(step, 1, newer)).toBe(newer)
  })
})

describe('undoStamps', () => {
  it('inverts each change: after → before', () => {
    const back = undoStamps(new Map([[1, { before: d(1), after: d(5) }]]))
    expect([...back]).toEqual([[1, { before: d(5), after: d(1) }]])
    expect(stampAfter(back, 1, d(5))).toEqual(d(1))
  })
})
