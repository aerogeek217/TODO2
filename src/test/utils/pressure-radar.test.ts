import { describe, expect, it } from 'vitest'
import { buildPressureRadar, quarterTasks, radarPointText, RADAR_RINGS } from '../../utils/pressure-radar'

const TODAY = new Date(2026, 10, 18, 10)
const day = (offset: number) => new Date(2026, 10, 18 + offset, 9)
const WAITING = 7

type T = Parameters<typeof buildPressureRadar>[0][number]
function task(id: number, fields: Partial<T> = {}): T {
  return { id, isCompleted: false, createdAt: day(-40), modifiedAt: day(-1), ...fields }
}

const radar = (todos: T[], staleAfterDays = 30) =>
  buildPressureRadar(todos, { today: TODAY, waitingStatusIds: new Set([WAITING]), staleAfterDays })

describe('the Pressure radar (task maps R1)', () => {
  it('puts each open task in one quarter by what presses on it', () => {
    const r = radar([
      task(1, { dueDate: day(3) }),
      task(2, { nextFollowupAt: day(-2) }),
      // Due date and follow-up: the sooner wins; a tie goes to the due date.
      task(3, { dueDate: day(9), nextFollowupAt: day(4) }),
      task(4, { dueDate: day(4), nextFollowupAt: day(4) }),
      // A Waiting status wins over any date: its next follow-up, else a week after the last one.
      task(5, { statusId: WAITING, dueDate: day(-3), nextFollowupAt: day(2) }),
      task(6, { statusId: WAITING, lastFollowupAt: day(-10) }),
      task(7, { statusId: WAITING, createdAt: day(-3) }),
      // No date at all: by when it goes stale.
      task(8, { modifiedAt: day(-35) }),
      task(9, { modifiedAt: day(-5) }),
      // Completed: left out.
      task(10, { isCompleted: true, dueDate: day(-1) }),
    ])
    const by = new Map(r.points.map((p) => [p.todo.id, [p.quarter, p.needsIn]]))
    expect(Object.fromEntries(by)).toEqual({
      1: ['due', 3],
      2: ['followup', -2],
      3: ['followup', 4],
      4: ['due', 4],
      5: ['waiting', 2],
      6: ['waiting', -3],
      7: ['waiting', 4],
      8: ['untouched', -5],
      9: ['untouched', 25],
    })
    expect(r.counts).toEqual({
      due: { total: 2, now: 0 },
      followup: { total: 2, now: 1 },
      waiting: { total: 3, now: 1 },
      untouched: { total: 2, now: 1 },
    })
    // Now: the latest first.
    expect(r.now.map((p) => p.todo.id)).toEqual([8, 6, 2])
    expect(quarterTasks(r, 'waiting').map((p) => p.todo.id)).toEqual([6, 5, 7])
  })

  it('stale off: an undated task goes stale after 30 days', () => {
    const r = radar([task(1, { modifiedAt: day(-31) })], 0)
    expect(r.points[0]).toMatchObject({ quarter: 'untouched', needsIn: -1 })
  })

  it('nearer the middle the sooner: now inside the NOW disk, the latest nearest; each in its own quarter', () => {
    const r = radar([-20, -5, 0, 3, 7, 14, 21, 40].map((d, i) => task(i + 1, { dueDate: day(d) })))
    const radii = r.points.map((p) => p.r)
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeGreaterThan(radii[i - 1]!)
    expect(r.points.filter((p) => p.needsIn <= 0).every((p) => p.r < RADAR_RINGS.now)).toBe(true)
    expect(r.points.filter((p) => p.needsIn > 0).every((p) => p.r > RADAR_RINGS.now)).toBe(true)
    // Due date is the top-right quarter: −90° to 0°.
    expect(r.points.every((p) => p.angle > -90 && p.angle < 0)).toBe(true)
  })

  it('places the same tasks the same way every time', () => {
    const todos = [task(1, { dueDate: day(2) }), task(2, { nextFollowupAt: day(5) })]
    expect(radar(todos).points.map((p) => [p.r, p.angle])).toEqual(radar(todos).points.map((p) => [p.r, p.angle]))
  })

  it('says what presses on a dot', () => {
    expect(radarPointText('due', -3, 30)).toBe('3 days overdue')
    expect(radarPointText('due', 0, 30)).toBe('due today')
    expect(radarPointText('followup', 1, 30)).toBe('follow-up in 1 day')
    expect(radarPointText('waiting', -2, 30)).toBe('waiting · chase 2 days late')
    expect(radarPointText('untouched', -4, 30)).toBe('untouched 34 days · stale')
  })
})
