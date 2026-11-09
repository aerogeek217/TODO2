import { describe, expect, it } from 'vitest'
import {
  breakdownColumns,
  columnIsLit,
  derivedBreakdownColumns,
  DUE_COLUMN_COLOR,
  FOLLOWUP_COLUMN_COLOR,
  isBreakdownColumnId,
  liveBreakdownSort,
  newBreakdownColumnId,
  newBreakdownConfig,
  type BreakdownColumn,
} from '../../models/chart-widgets'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import type { TabBadgeRanges } from '../../models/list-definition'

/**
 * A Breakdown's count columns (board BC, G3): a config from before them
 * reads its old Due / Follow-up ranges as columns — each split into a lit
 * late column and an unlit due-soon one — with no schema step.
 */

const APP: TabBadgeRanges = { due: 3, followup: 0 }

const range = (field: 'deadline' | 'followup', start: number | null, end: number): TodoPredicate => ({
  ...emptyPredicate(),
  dates: { [field]: { match: 'range', start: start == null ? null : { kind: 'offset', days: start }, end: { kind: 'offset', days: end } } },
})

const summary = (cols: readonly BreakdownColumn[]) => cols.map((c) => [c.id, c.name, c.litWhen, c.litAt])

describe('derivedBreakdownColumns: the old ranges as count columns', () => {
  it('Settings’ ranges: Overdue (lit above 0) and Due soon (today … +N, never lit); Follow-up late and Follow-up due (today only at 0)', () => {
    const cols = derivedBreakdownColumns(undefined, APP)
    expect(summary(cols)).toEqual([
      ['overdue', 'Overdue', 'above', 0],
      ['due-soon', 'Due soon', 'never', undefined],
      ['followup-late', 'Follow-up late', 'above', 0],
      ['followup-due', 'Follow-up due', 'never', undefined],
    ])
    expect(cols.map((c) => c.filter)).toEqual([
      range('deadline', null, -1),
      range('deadline', 0, 3),
      range('followup', null, -1),
      range('followup', 0, 0),
    ])
    expect(cols.map((c) => c.color)).toEqual([DUE_COLUMN_COLOR, DUE_COLUMN_COLOR, FOLLOWUP_COLUMN_COLOR, FOLLOWUP_COLUMN_COLOR])
  })

  it('`overdue` keeps only the late column; `off` drops both; its own range wins over Settings’, the other follows Settings', () => {
    expect(summary(derivedBreakdownColumns({ due: 'overdue' }, APP)).map((c) => c[0])).toEqual(['overdue', 'followup-late', 'followup-due'])
    expect(summary(derivedBreakdownColumns({ followup: 'off' }, APP)).map((c) => c[0])).toEqual(['overdue', 'due-soon'])
    expect(derivedBreakdownColumns('off', APP)).toEqual([])
    expect(derivedBreakdownColumns({ due: 7 }, APP)[1]?.filter).toEqual(range('deadline', 0, 7))
    expect(derivedBreakdownColumns(undefined, { due: 'off', followup: 'overdue' }).map((c) => c.id)).toEqual(['followup-late'])
  })

  it('a config’s own columns win; without them (a new Breakdown too) the derived ones', () => {
    const own: BreakdownColumn[] = [{ id: 'col-a', name: 'Waiting', color: '#7ec4bc', filter: emptyPredicate(), litWhen: 'never' }]
    expect(breakdownColumns({ ...newBreakdownConfig(emptyPredicate()), columns: own, badges: 'off' }, APP)).toBe(own)
    expect(breakdownColumns(newBreakdownConfig(emptyPredicate()), APP)).toHaveLength(4)
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
  const derived = derivedBreakdownColumns(undefined, APP).map((c) => c.id)

  it('a fixed heading or a column it has: as stored; one it no longer has: the default order', () => {
    expect(liveBreakdownSort({ by: 'open', reversed: true }, derived)).toEqual({ by: 'open', reversed: true })
    expect(liveBreakdownSort({ by: 'due-soon' }, derived)).toEqual({ by: 'due-soon' })
    expect(liveBreakdownSort({ by: 'col-gone' }, derived)).toBeUndefined()
    expect(liveBreakdownSort(undefined, derived)).toBeUndefined()
  })

  it('the old Due / Follow-up columns’ sort (overdue included) reads as the late column, keeping its direction', () => {
    expect(liveBreakdownSort({ by: 'due' }, derived)).toEqual({ by: 'overdue' })
    expect(liveBreakdownSort({ by: 'followup', reversed: true }, derived)).toEqual({ by: 'followup-late', reversed: true })
    // Without the late column: the default order.
    expect(liveBreakdownSort({ by: 'due' }, derivedBreakdownColumns({ due: 'off' }, APP).map((c) => c.id))).toBeUndefined()
    // A column of its own named so wins.
    expect(liveBreakdownSort({ by: 'due' }, ['due', 'overdue'])).toEqual({ by: 'due' })
  })
})
