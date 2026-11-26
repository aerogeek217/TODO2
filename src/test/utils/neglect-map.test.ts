import { describe, it, expect } from 'vitest'
import {
  buildNeglectMap,
  dateInText,
  NEGLECT_JITTER,
  NEGLECT_X_CAP,
  NEGLECT_Y_MAX,
  NEGLECT_Y_MIN,
  neglectDotColour,
  neglectJitter,
  neglectZone,
  projectTagIds,
  staleLineShown,
  untouchedText,
  type NeglectFields,
} from '../../utils/neglect-map'
import { isDueNear } from '../../utils/urgency'

// Tue 10 Nov 2026.
const today = new Date(2026, 10, 10)
const opts = { today, staleAfterDays: 14, dueSoonDays: 3 }

let nextId = 1
/** A task untouched `untouched` days (modified at 9:00 that day), due in `due` days (none when absent). */
function task(untouched: number, due?: number, extra: Partial<NeglectFields> = {}): NeglectFields {
  return {
    id: nextId++,
    modifiedAt: new Date(2026, 10, 10 - untouched, 9),
    ...(due != null ? { dueDate: new Date(2026, 10, 10 + due) } : {}),
    isCompleted: false,
    ...extra,
  }
}

describe('neglectZone', () => {
  it('cuts at Stale after: 13 days is touched, 14 stale', () => {
    expect(neglectZone(13, -1, opts)).toBe('inHand')
    expect(neglectZone(14, -1, opts)).toBe('slipping')
    expect(neglectZone(13, 10, opts)).toBe('later')
    expect(neglectZone(14, 10, opts)).toBe('drifting')
  })

  it('cuts at the due-soon line: due within the range (or late) is near, a day past it is not', () => {
    expect(neglectZone(20, 3, opts)).toBe('slipping')
    expect(neglectZone(20, 4, opts)).toBe('drifting')
    expect(neglectZone(0, 3, opts)).toBe('inHand')
    expect(neglectZone(0, 4, opts)).toBe('later')
    // Today and late count as near too.
    expect(neglectZone(20, 0, opts)).toBe('slipping')
    expect(neglectZone(20, -30, opts)).toBe('slipping')
  })

  it('with the due-soon range off, only a late task is near; with Today, today too', () => {
    const off = { ...opts, dueSoonDays: null }
    expect(neglectZone(20, -1, off)).toBe('slipping')
    expect(neglectZone(20, 0, off)).toBe('drifting')
    const todayOnly = { ...opts, dueSoonDays: 0 }
    expect(neglectZone(20, 0, todayOnly)).toBe('slipping')
    expect(neglectZone(20, 1, todayOnly)).toBe('drifting')
    expect(isDueNear(-1, null)).toBe(true)
    expect(isDueNear(0, null)).toBe(false)
  })

  it('a task with neither date is Forgotten once stale, else just no dates', () => {
    expect(neglectZone(13, null, opts)).toBe('noDates')
    expect(neglectZone(14, null, opts)).toBe('forgotten')
  })

  it('Stale after 0 (off): nothing is stale, so nothing slips, drifts or is forgotten', () => {
    const off = { ...opts, staleAfterDays: 0 }
    expect(neglectZone(400, -3, off)).toBe('inHand')
    expect(neglectZone(400, 20, off)).toBe('later')
    expect(neglectZone(400, null, off)).toBe('noDates')
  })
})

describe('buildNeglectMap', () => {
  it('places each open task by days untouched and days until due; completed tasks are left out', () => {
    const a = task(20, -4)
    const b = task(2, 10)
    const done = task(30, -2, { isCompleted: true })
    const map = buildNeglectMap([a, b, done], opts)
    expect(map.points.map((p) => p.todo.id)).toEqual([a.id, b.id])
    expect(map.points[0]).toMatchObject({ untouched: 20, dateIn: -4, dateBy: 'due', zone: 'slipping', x: 20, y: -4 })
    expect(map.points[1]).toMatchObject({ untouched: 2, dateIn: 10, dateBy: 'due', zone: 'later', x: 2, y: 10 })
    expect(map.counts).toEqual({ slipping: 1, inHand: 0, later: 1, drifting: 0, forgotten: 0, noDates: 0 })
  })

  it('caps x at 60 days and clamps y to 14 days late – 30 days ahead, keeping the real numbers', () => {
    const old = task(200, -40)
    const far = task(5, 90)
    const map = buildNeglectMap([old, far], opts)
    expect(map.points[0]).toMatchObject({ untouched: 200, dateIn: -40, x: NEGLECT_X_CAP, y: NEGLECT_Y_MIN })
    expect(map.points[1]).toMatchObject({ untouched: 5, dateIn: 90, x: 5, y: NEGLECT_Y_MAX })
  })

  it('a stamp in the future counts as touched today', () => {
    const map = buildNeglectMap([task(-3, 1)], opts)
    expect(map.points[0]).toMatchObject({ untouched: 0, x: 0 })
  })

  it('puts tasks with neither date in the strip, Forgotten or not', () => {
    const fresh = task(3)
    const old = task(40)
    const map = buildNeglectMap([fresh, old], opts)
    expect(map.points.map((p) => [p.zone, p.dateIn, p.dateBy, p.y])).toEqual([['noDates', null, null, 0.5], ['forgotten', null, null, 0.5]])
    expect(map.counts.noDates).toBe(1)
    expect(map.counts.forgotten).toBe(1)
  })

  it('places a task by the earlier of its due date and next follow-up, the due date on a tie', () => {
    const followupFirst = task(20, 10, { nextFollowupAt: new Date(2026, 10, 9) })
    const dueFirst = task(20, 1, { nextFollowupAt: new Date(2026, 10, 15) })
    const onlyFollowup = task(20, undefined, { nextFollowupAt: new Date(2026, 10, 12) })
    const tie = task(2, 4, { nextFollowupAt: new Date(2026, 10, 14) })
    const map = buildNeglectMap([followupFirst, dueFirst, onlyFollowup, tie], opts)
    expect(map.points.map((p) => [p.dateIn, p.dateBy, p.zone])).toEqual([
      [-1, 'followup', 'slipping'],
      [1, 'due', 'slipping'],
      [2, 'followup', 'slipping'],
      [4, 'due', 'later'],
    ])
  })

  it('leaves off a task whose only date is a planned day: no zone, no count', () => {
    const plannedOnly = task(40, undefined, { doDate: new Date(2026, 10, 12) })
    const plannedAndDue = task(40, 2, { doDate: new Date(2026, 10, 12) })
    const map = buildNeglectMap([plannedOnly, plannedAndDue], opts)
    expect(map.points.map((p) => p.todo.id)).toEqual([plannedAndDue.id])
    expect(map.counts).toEqual({ slipping: 1, inHand: 0, later: 0, drifting: 0, forgotten: 0, noDates: 0 })
  })

  it('leaves off a task with a hidden status: no zone, no count', () => {
    const parked = task(40, 2, { statusId: 4 })
    const waiting = task(40, 2, { statusId: 2 })
    const none = task(40)
    const map = buildNeglectMap([parked, waiting, none], { ...opts, hiddenStatusIds: [4] })
    expect(map.points.map((p) => p.todo.id)).toEqual([waiting.id, none.id])
    expect(map.counts).toEqual({ slipping: 1, inHand: 0, later: 0, drifting: 0, forgotten: 1, noDates: 0 })
  })

  it('draws Stale after’s line only while it is on and short of the cap', () => {
    expect(staleLineShown(14)).toBe(true)
    expect(staleLineShown(59)).toBe(true)
    expect(staleLineShown(0)).toBe(false)
    expect(staleLineShown(60)).toBe(false)
    expect(staleLineShown(90)).toBe(false)
    // Past the cap a task is still stale by its real days: it sits on the cap.
    const map = buildNeglectMap([task(100, -1), task(70, -2)], { ...opts, staleAfterDays: 90 })
    expect(map.points.map((p) => [p.zone, p.x])).toEqual([['slipping', NEGLECT_X_CAP], ['inHand', NEGLECT_X_CAP]])
  })

  it('lists Slipping latest first, then the longest untouched', () => {
    const late2 = task(15, -2)
    const late9 = task(20, -9)
    const late2older = task(40, -2)
    const soon = task(30, 1)
    const notSlipping = task(3, -5)
    const map = buildNeglectMap([late2, late9, late2older, soon, notSlipping], opts)
    expect(map.slipping.map((p) => p.todo.id)).toEqual([late9.id, late2older.id, late2.id, soon.id])
  })

  it('lists Forgotten the longest untouched first', () => {
    const a = task(20)
    const b = task(63)
    const c = task(31)
    const fresh = task(2)
    const map = buildNeglectMap([a, b, c, fresh], opts)
    expect(map.forgotten.map((p) => p.todo.id)).toEqual([b.id, c.id, a.id])
  })

  it('moves only dots that share a spot, by id: the same every time, within the jitter', () => {
    const alone = task(20, 5)
    const a = task(30, 8)
    const b = task(30, 8)
    const first = buildNeglectMap([alone, a, b], opts)
    const again = buildNeglectMap([alone, a, b], opts)
    expect(first.points[0]).toMatchObject({ x: 20, y: 5 })
    expect(first.points.map((p) => [p.x, p.y])).toEqual(again.points.map((p) => [p.x, p.y]))
    const [pa, pb] = [first.points[1]!, first.points[2]!]
    expect([pa.x, pa.y]).not.toEqual([pb.x, pb.y])
    for (const p of [pa, pb]) {
      expect(Math.abs(p.x - 30)).toBeLessThanOrEqual(NEGLECT_JITTER)
      expect(Math.abs(p.y - 8)).toBeLessThanOrEqual(NEGLECT_JITTER)
    }
  })

  it('never moves a dot across a line it sits on, or off the plot', () => {
    // Many dots on Stale after and the due-soon line, on today, and at the corners.
    const spots: Array<[number, number]> = [[14, 3], [14, 0], [0, -14], [60, 30], [0, 30], [60, -14]]
    const todos = spots.flatMap(([u, d]) => Array.from({ length: 12 }, () => task(u, d)))
    const map = buildNeglectMap(todos, opts)
    for (const p of map.points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(NEGLECT_X_CAP)
      expect(p.y).toBeGreaterThanOrEqual(NEGLECT_Y_MIN)
      expect(p.y).toBeLessThanOrEqual(NEGLECT_Y_MAX)
      if (p.untouched === 14) expect(p.x).toBeGreaterThanOrEqual(14)
      if (p.dateIn === 3) expect(p.y).toBeLessThanOrEqual(3)
      if (p.dateIn === 0) expect(p.y).toBeGreaterThanOrEqual(0)
    }
    // Today and the due-soon line at once (range Today): such a dot stays on the line.
    const both = buildNeglectMap([task(20, 0), task(20, 0)], { ...opts, dueSoonDays: 0 })
    expect(both.points.map((p) => p.y)).toEqual([0, 0])
  })

  it('spreads strip dots that share a spot across its middle', () => {
    const map = buildNeglectMap([task(60), task(60), task(70)], opts)
    for (const p of map.points) {
      expect(p.y).toBeGreaterThanOrEqual(0.1)
      expect(p.y).toBeLessThanOrEqual(0.9)
      expect(p.x).toBeLessThanOrEqual(NEGLECT_X_CAP)
    }
    expect(new Set(map.points.map((p) => p.y)).size).toBe(3)
  })
})

describe('neglectJitter', () => {
  it('is fixed by id and salt, in [-1, 1)', () => {
    const values = Array.from({ length: 500 }, (_, i) => neglectJitter(i, 1))
    expect(values).toEqual(Array.from({ length: 500 }, (_, i) => neglectJitter(i, 1)))
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThan(1)
    }
    expect(neglectJitter(7, 1)).not.toBe(neglectJitter(7, 2))
    // Spread out, not bunched on one side.
    expect(values.filter((v) => v < 0).length).toBeGreaterThan(150)
    expect(values.filter((v) => v > 0).length).toBeGreaterThan(150)
  })
})

describe('the map’s words and colours', () => {
  it('words the date that placed a task, and the days untouched', () => {
    expect(dateInText(-4, 'due')).toBe('4d late')
    expect(dateInText(0, 'due')).toBe('due today')
    expect(dateInText(3, 'due')).toBe('due in 3d')
    expect(dateInText(-2, 'followup')).toBe('follow-up 2d late')
    expect(dateInText(0, 'followup')).toBe('follow-up today')
    expect(dateInText(5, 'followup')).toBe('follow-up in 5d')
    expect(dateInText(null, null)).toBe('no dates')
    expect(untouchedText(26)).toBe('26d untouched')
    expect(untouchedText(0)).toBe('touched today')
  })

  it('picks the `Project: …` tags for a new map', () => {
    expect(projectTagIds([
      { id: 1, name: 'Project: Alpha' },
      { id: 2, name: 'urgent' },
      { id: 3, name: 'Project:Beta' },
      { name: 'Project: unsaved' },
      { id: 4, name: 'project: lower' },
    ])).toEqual([1, 3])
  })

  it('colours a dot by the first picked tag it has, its first person, or not at all', () => {
    const tags = [{ id: 5, color: '#111111' }, { id: 2, color: '#222222' }]
    expect(neglectDotColour({ kind: 'tags', tagIds: [2, 5] }, tags, undefined)).toBe('#222222')
    expect(neglectDotColour({ kind: 'tags', tagIds: [5, 2] }, tags, undefined)).toBe('#111111')
    expect(neglectDotColour({ kind: 'tags', tagIds: [9] }, tags, undefined)).toBeNull()
    expect(neglectDotColour({ kind: 'tags', tagIds: [] }, tags, undefined)).toBeNull()
    expect(neglectDotColour({ kind: 'people' }, tags, [{ color: '#333333' }, { color: '#444444' }])).toBe('#333333')
    expect(neglectDotColour({ kind: 'people' }, tags, [{}])).toBeNull()
    expect(neglectDotColour({ kind: 'people' }, tags, undefined)).toBeNull()
    expect(neglectDotColour({ kind: 'none' }, tags, [{ color: '#333333' }])).toBeNull()
  })
})
