import { describe, it, expect } from 'vitest'
import { doneToday, tallyLabel, tallyLayout, tallyMarks, tasksDoneToday, TALLY_GROUP_PITCH_PX, TALLY_GROUP_WIDTH_PX } from '../../utils/tally'

/** The top bar's tally (flair P3): today's completions, the groups that fit, their shapes. */

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min)

describe('doneToday', () => {
  const today = at(2026, 10, 15, 9)

  it('counts the tasks completed on today’s local day, from its first moment to its last', () => {
    const todos = [
      { isCompleted: true, completedAt: at(2026, 10, 15, 0, 0) },
      { isCompleted: true, completedAt: at(2026, 10, 15, 23, 59) },
      { isCompleted: true, completedAt: at(2026, 10, 14, 23, 59) },
      { isCompleted: true, completedAt: at(2026, 10, 16, 0, 0) },
    ]
    expect(doneToday(todos, today)).toBe(2)
  })

  it('skips open tasks and a completed one without a time (a reopen clears it)', () => {
    expect(doneToday([
      { isCompleted: false, completedAt: at(2026, 10, 15) },
      { isCompleted: true, completedAt: undefined },
    ], today)).toBe(0)
  })

  it('reads a stored ISO string as the moment it names', () => {
    const iso = at(2026, 10, 15, 10).toISOString() as unknown as Date
    expect(doneToday([{ isCompleted: true, completedAt: iso }], today)).toBe(1)
  })

  it('a new day starts at zero', () => {
    const todos = [{ isCompleted: true, completedAt: at(2026, 10, 15, 22) }]
    expect(doneToday(todos, at(2026, 10, 16, 0, 1))).toBe(0)
  })
})

describe('tasksDoneToday', () => {
  const today = at(2026, 10, 15, 9)

  it('lists the tasks doneToday counts, the one completed last first', () => {
    const todos = [
      { title: 'morning', isCompleted: true, completedAt: at(2026, 10, 15, 8) },
      { title: 'open', isCompleted: false, completedAt: at(2026, 10, 15, 9) },
      { title: 'evening', isCompleted: true, completedAt: at(2026, 10, 15, 21) },
      { title: 'yesterday', isCompleted: true, completedAt: at(2026, 10, 14, 23, 59) },
      { title: 'no time', isCompleted: true, completedAt: undefined },
      { title: 'noon', isCompleted: true, completedAt: at(2026, 10, 15, 12).toISOString() as unknown as Date },
    ]
    const done = tasksDoneToday(todos, today)
    expect(done.map((t) => t.title)).toEqual(['evening', 'noon', 'morning'])
    expect(done).toHaveLength(doneToday(todos, today))
  })

  it('is empty with none', () => {
    expect(tasksDoneToday([], today)).toEqual([])
  })
})

describe('tallyLayout', () => {
  it('nothing for no tasks, or no room for one whole group', () => {
    expect(tallyLayout(0, 500).width).toBe(0)
    expect(tallyLayout(12, TALLY_GROUP_WIDTH_PX - 1).width).toBe(0)
  })

  it('every group and the open group’s strokes when they fit', () => {
    const l = tallyLayout(12, 500)
    expect(l).toMatchObject({ first: 0, groups: 2, remainder: 2 })
    expect(l.width).toBeGreaterThan(2 * TALLY_GROUP_PITCH_PX)
  })

  it('whole groups only: no open group, the last slash ends the wall', () => {
    expect(tallyLayout(10, 500)).toMatchObject({ groups: 2, remainder: 0, width: TALLY_GROUP_PITCH_PX + TALLY_GROUP_WIDTH_PX })
  })

  it('too narrow for them all: the newest whole groups and the open strokes, the oldest left out', () => {
    const l = tallyLayout(23, 3 * TALLY_GROUP_PITCH_PX + 10)
    expect(l.remainder).toBe(3)
    expect(l.groups).toBeLessThan(4)
    expect(l.first).toBe((4 - l.groups) * 5)
    expect(l.width).toBeLessThanOrEqual(3 * TALLY_GROUP_PITCH_PX + 10)
  })
})

describe('tallyMarks', () => {
  it('four strokes then a slash per group, each group a pitch to the right', () => {
    const marks = tallyMarks(tallyLayout(7, 500))
    expect(marks.map((m) => m.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(marks.map((m) => m.x)).toEqual([0, 0, 0, 0, 0, TALLY_GROUP_PITCH_PX, TALLY_GROUP_PITCH_PX])
    // The slash is the long one across the group.
    expect(marks[4]?.path).toMatch(/^M\.9 12/)
  })

  it('a mark keeps its shape when older groups leave', () => {
    const all = tallyMarks(tallyLayout(23, 500))
    const newest = tallyMarks(tallyLayout(23, 2 * TALLY_GROUP_PITCH_PX))
    for (const m of newest) expect(m.path).toBe(all.find((a) => a.index === m.index)?.path)
    expect(newest[0]?.x).toBe(0)
  })
})

describe('tallyLabel', () => {
  it('says how many', () => {
    expect(tallyLabel(10)).toBe('10 done today')
  })
})
