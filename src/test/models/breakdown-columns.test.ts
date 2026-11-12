import { describe, expect, it } from 'vitest'
import {
  breakdownColumns,
  columnIsLit,
  defaultBreakdownColumns,
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
 * a new Breakdown writes Due and Follow-up as its `columns`. (A config from
 * before them — its old `badges`, its sorts by the older derived columns —
 * v79 rewrote: `v79-upgrade.test`.)
 */

const APP: TabBadgeRanges = { due: 3, followup: 0 }

/** A range from any day before up to `end` days from today. */
const by = (field: 'deadline' | 'followup', end: number): TodoPredicate => ({
  ...emptyPredicate(),
  dates: { [field]: { match: 'range', start: null, end: { kind: 'offset', days: end } } },
})

const summary = (cols: readonly BreakdownColumn[]) => cols.map((c) => [c.id, c.name, c.color, c.litWhen, c.litAt])

describe('defaultBreakdownColumns: a new Breakdown’s', () => {
  it('Settings’ ranges: Due (by today + N, overdue included) and Follow-up (by today + its N), each lit above 0 in its colour', () => {
    const cols = defaultBreakdownColumns(APP)
    expect(summary(cols)).toEqual([
      ['due', 'Due', DUE_COLUMN_COLOR, 'above', 0],
      ['followup', 'Follow-up', FOLLOWUP_COLUMN_COLOR, 'above', 0],
    ])
    expect(cols.map((c) => c.filter)).toEqual([by('deadline', 3), by('followup', 0)])
    // Each a valid stored column id.
    expect(cols.every((c) => isBreakdownColumnId(c.id))).toBe(true)
  })

  it('a range `off` drops its column; `overdue` counts only the late tasks (up to yesterday)', () => {
    expect(defaultBreakdownColumns({ due: 'off', followup: 2 }).map((c) => [c.id, c.filter])).toEqual([['followup', by('followup', 2)]])
    expect(defaultBreakdownColumns({ due: 'off', followup: 'overdue' }).map((c) => [c.id, c.filter])).toEqual([['followup', by('followup', -1)]])
    expect(defaultBreakdownColumns({ due: 'off', followup: 'off' })).toEqual([])
  })

  it('a config’s own columns win; without them (a hand-made file) the defaults', () => {
    const own: BreakdownColumn[] = [{ id: 'col-a', name: 'Waiting', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }]
    expect(breakdownColumns({ ...newBreakdownConfig(emptyPredicate()), columns: own }, APP)).toBe(own)
    expect(breakdownColumns(newBreakdownConfig(emptyPredicate()), APP).map((c) => c.id)).toEqual(['due', 'followup'])
    expect(breakdownColumns({ ...newBreakdownConfig(emptyPredicate()), columns: [] }, APP)).toEqual([])
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
  const ids = defaultBreakdownColumns(APP).map((c) => c.id)

  it('a fixed heading or a column it has: as stored; one it no longer has: the default order', () => {
    expect(liveBreakdownSort({ by: 'open', reversed: true }, ids)).toEqual({ by: 'open', reversed: true })
    expect(liveBreakdownSort({ by: 'name' }, ids)).toEqual({ by: 'name' })
    expect(liveBreakdownSort({ by: 'due' }, ids)).toEqual({ by: 'due' })
    expect(liveBreakdownSort({ by: 'followup', reversed: true }, ids)).toEqual({ by: 'followup', reversed: true })
    expect(liveBreakdownSort({ by: 'col-gone' }, ids)).toBeUndefined()
    expect(liveBreakdownSort(undefined, ids)).toBeUndefined()
  })

  it('an older key (v79 rewrote every stored one) is no column: the default order', () => {
    expect(liveBreakdownSort({ by: 'overdue' }, ids)).toBeUndefined()
    expect(liveBreakdownSort({ by: 'priority' }, ids)).toBeUndefined()
    // A column that has the id keeps its sort.
    expect(liveBreakdownSort({ by: 'overdue' }, ['overdue', 'due-soon'])).toEqual({ by: 'overdue' })
  })

  it('a stored view keeps a sort by a column it no longer has as it is (read at render, never a fix that marks the layout)', () => {
    const sorts = { people: { by: 'col-gone' }, tags: { by: 'due', reversed: true } }
    expect(pickBreakdownView({ sorts })).toEqual({ config: { sorts }, fixed: false })
  })
})
