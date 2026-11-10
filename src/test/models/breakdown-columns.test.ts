import { describe, expect, it } from 'vitest'
import {
  breakdownColumns,
  columnIsLit,
  defaultBreakdownColumns,
  derivedBreakdownColumns,
  DUE_COLUMN_COLOR,
  FOLLOWUP_COLUMN_COLOR,
  isBreakdownColumnId,
  liveBreakdownSort,
  newBreakdownColumnId,
  newBreakdownConfig,
  pickBreakdownView,
  type BreakdownColumn,
} from '../../models/chart-widgets'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import type { TabBadgeRanges } from '../../models/list-definition'

/**
 * A Breakdown's count columns (board BC, G3; every column a count column):
 * a new Breakdown writes Due and Follow-up as its `columns`; a config from
 * before reads its old Due / Follow-up ranges as those two — overdue
 * included — with no schema step.
 */

const APP: TabBadgeRanges = { due: 3, followup: 0 }

/** A range from any day before up to `end` days from today. */
const by = (field: 'deadline' | 'followup', end: number): TodoPredicate => ({
  ...emptyPredicate(),
  dates: { [field]: { match: 'range', start: null, end: { kind: 'offset', days: end } } },
})

const summary = (cols: readonly BreakdownColumn[]) => cols.map((c) => [c.id, c.name, c.color, c.litWhen, c.litAt])

describe('derivedBreakdownColumns: the old ranges as count columns', () => {
  it('Settings’ ranges: Due (by today + N, overdue included) and Follow-up (by today + its N), each lit above 0 in its colour', () => {
    const cols = derivedBreakdownColumns(undefined, APP)
    expect(summary(cols)).toEqual([
      ['due', 'Due', DUE_COLUMN_COLOR, 'above', 0],
      ['followup', 'Follow-up', FOLLOWUP_COLUMN_COLOR, 'above', 0],
    ])
    expect(cols.map((c) => c.filter)).toEqual([by('deadline', 3), by('followup', 0)])
  })

  it('a range `off` drops its column; `overdue` counts only the late tasks (up to yesterday)', () => {
    expect(derivedBreakdownColumns({ followup: 'off' }, APP).map((c) => c.id)).toEqual(['due'])
    expect(derivedBreakdownColumns({ due: 'off' }, APP).map((c) => c.id)).toEqual(['followup'])
    expect(derivedBreakdownColumns('off', APP)).toEqual([])
    const late = derivedBreakdownColumns({ due: 'overdue' }, APP)
    expect(late.map((c) => [c.id, c.filter])).toEqual([['due', by('deadline', -1)], ['followup', by('followup', 0)]])
    expect(derivedBreakdownColumns(undefined, { due: 'off', followup: 'overdue' }).map((c) => [c.id, c.filter])).toEqual([['followup', by('followup', -1)]])
  })

  it('its own range wins over Settings’; the other follows Settings', () => {
    expect(derivedBreakdownColumns({ due: 7 }, APP).map((c) => c.filter)).toEqual([by('deadline', 7), by('followup', 0)])
    expect(derivedBreakdownColumns({ followup: 5 }, { due: 'overdue', followup: 0 }).map((c) => c.filter)).toEqual([by('deadline', -1), by('followup', 5)])
  })

  it('a config’s own columns win; without them the derived ones', () => {
    const own: BreakdownColumn[] = [{ id: 'col-a', name: 'Waiting', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }]
    expect(breakdownColumns({ ...newBreakdownConfig(emptyPredicate()), columns: own, badges: 'off' }, APP)).toBe(own)
    expect(breakdownColumns(newBreakdownConfig(emptyPredicate()), APP).map((c) => c.id)).toEqual(['due', 'followup'])
    expect(breakdownColumns({ ...newBreakdownConfig(emptyPredicate()), columns: [] }, APP)).toEqual([])
  })
})

describe('defaultBreakdownColumns: a new Breakdown’s', () => {
  it('Due and Follow-up in Settings’ ranges of the moment, as ordinary columns', () => {
    expect(defaultBreakdownColumns(APP)).toEqual(derivedBreakdownColumns(undefined, APP))
    expect(defaultBreakdownColumns({ due: 'off', followup: 2 }).map((c) => [c.id, c.filter])).toEqual([['followup', by('followup', 2)]])
    // Each a valid stored column id.
    expect(defaultBreakdownColumns(APP).every((c) => isBreakdownColumnId(c.id))).toBe(true)
  })
})

describe('a count column', () => {
  it('lights as a Number does: above / below its threshold, never with Never', () => {
    expect(columnIsLit({ litWhen: 'above', litAt: 0 }, 1)).toBe(true)
    expect(columnIsLit({ litWhen: 'above', litAt: 2 }, 2)).toBe(false)
    expect(columnIsLit({ litWhen: 'below', litAt: 3 }, 2)).toBe(true)
    expect(columnIsLit({ litWhen: 'never' }, 99)).toBe(false)
  })

  it('a new id is fresh and never a fixed heading', () => {
    const id = newBreakdownColumnId([{ id: 'col-a' }])
    expect(id).not.toBe('col-a')
    expect(isBreakdownColumnId(id)).toBe(true)
    expect(isBreakdownColumnId('open')).toBe(false)
    expect(isBreakdownColumnId('name')).toBe(false)
    expect(isBreakdownColumnId('two words')).toBe(false)
  })
})

describe('liveBreakdownSort: a stored sort as the headings read it', () => {
  const derived = derivedBreakdownColumns(undefined, APP).map((c) => c.id)

  it('a fixed heading or a column it has: as stored; one it no longer has: the default order', () => {
    expect(liveBreakdownSort({ by: 'open', reversed: true }, derived)).toEqual({ by: 'open', reversed: true })
    expect(liveBreakdownSort({ by: 'name' }, derived)).toEqual({ by: 'name' })
    expect(liveBreakdownSort({ by: 'due' }, derived)).toEqual({ by: 'due' })
    expect(liveBreakdownSort({ by: 'followup', reversed: true }, derived)).toEqual({ by: 'followup', reversed: true })
    expect(liveBreakdownSort({ by: 'col-gone' }, derived)).toBeUndefined()
    expect(liveBreakdownSort(undefined, derived)).toBeUndefined()
  })

  it('the old Priority column’s sort reads as the default order', () => {
    expect(liveBreakdownSort({ by: 'priority' }, derived)).toBeUndefined()
    expect(liveBreakdownSort({ by: 'priority', reversed: true }, [])).toBeUndefined()
  })

  it('the older derived columns’ sorts read as the Due / Follow-up column that holds their tasks, keeping the direction', () => {
    expect(liveBreakdownSort({ by: 'overdue' }, derived)).toEqual({ by: 'due' })
    expect(liveBreakdownSort({ by: 'due-soon', reversed: true }, derived)).toEqual({ by: 'due', reversed: true })
    expect(liveBreakdownSort({ by: 'followup-late' }, derived)).toEqual({ by: 'followup' })
    expect(liveBreakdownSort({ by: 'followup-due', reversed: true }, derived)).toEqual({ by: 'followup', reversed: true })
    // Without that column: the default order.
    expect(liveBreakdownSort({ by: 'overdue' }, derivedBreakdownColumns({ due: 'off' }, APP).map((c) => c.id))).toBeUndefined()
    // Columns written under the older ids (edited before) keep their own sorts.
    expect(liveBreakdownSort({ by: 'overdue' }, ['overdue', 'due-soon'])).toEqual({ by: 'overdue' })
  })

  it('a stored view keeps those sorts as they are (read at render, never a fix that marks the layout)', () => {
    const sorts = { people: { by: 'priority' }, tags: { by: 'followup-late', reversed: true } }
    expect(pickBreakdownView({ sorts })).toEqual({ config: { sorts }, fixed: false })
  })
})
