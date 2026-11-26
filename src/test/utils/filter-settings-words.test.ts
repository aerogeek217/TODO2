import { describe, expect, it } from 'vitest'
import type { FilterExpr } from '../../models/filter-expression'
import { emptyPredicate, type TodoItem } from '../../models'
import { pickPredicate } from '../../data/predicate-shape'
import { filterHistoryFields } from '../../services/stats/filter-history'
import { numberOrderField } from '../../services/stats/number-count'
import { useSettingsStore, currentFilterSettings } from '../../stores/settings-store'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { expressionToClauses, expressionWords, parseExpression, printExpression, type ExpressionNames } from '../../utils/filter-expression'
import { matchesFilter, type FilterSettings } from '../../utils/filter-match'
import { withExpression } from '../../utils/predicate-expression'
import { makeTodo } from '../helpers'

/**
 * The filter words that read Settings: `stale` (Stale after) and `due soon`
 * / `followup soon` (the due-soon range, `urgentDueWithinDays`). No duration
 * is written into the filter: it follows the Settings as they change.
 */

// Thu 26 Nov 2026.
const TODAY = new Date(2026, 10, 26)
const day = (offset: number) => new Date(2026, 10, 26 + offset, 9)

const names: ExpressionNames = { person: () => undefined, tag: () => undefined, status: (id) => (id === 1 ? 'Parked' : undefined) }
const resolve = { person: () => undefined, tag: () => undefined, status: (n: string) => (n.toLowerCase() === 'parked' ? 1 : undefined) }

function tree(text: string): FilterExpr | null {
  const r = parseExpression(text, { today: TODAY, names: resolve })
  if (!r.ok) throw new Error(`${text}: ${r.error.message}`)
  return r.expression
}

function errorOf(text: string): string {
  const r = parseExpression(text, { today: TODAY, names: resolve })
  if (r.ok) throw new Error(`${text} parsed`)
  return r.error.message
}

const settings = (over: Partial<FilterSettings> = {}): FilterSettings => ({ urgentRange: 3, weekStartsOn: 1, staleAfterDays: 30, ...over })

/** Whether `todo` passes the typed filter under `s`. */
function passes(text: string, todo: TodoItem, s: FilterSettings = settings()): boolean {
  const criteria = predicateToCriteria(withExpression(emptyPredicate(), tree(text), false))
  return matchesFilter(criteria, todo, [], TODAY, undefined, [], s)
}

describe('stale and soon: the grammar', () => {
  it('reads `stale`, `due soon` and `followup soon` as their atoms', () => {
    expect(tree('stale')).toEqual({ kind: 'stale' })
    expect(tree('due soon')).toEqual({ kind: 'soon', field: 'deadline' })
    expect(tree('followup soon')).toEqual({ kind: 'soon', field: 'followup' })
    expect(tree('follow-up soon')).toEqual({ kind: 'soon', field: 'followup' })
    expect(tree('not due soon and stale')).toEqual({ kind: 'and', items: [{ kind: 'not', item: { kind: 'soon', field: 'deadline' } }, { kind: 'stale' }] })
  })

  it('prints them back as typed, and the Neglect map’s zones read back the same', () => {
    for (const text of [
      'stale',
      'due soon',
      'followup soon',
      '(due soon or followup soon) and stale',
      'no due and no followup and planned none and stale',
      '(due any or followup any) and not due soon and not followup soon and stale and not !Parked',
    ]) {
      const t = tree(text)
      expect(tree(printExpression(t, false, names)), text).toEqual(t)
    }
    expect(printExpression(tree('due soon or followup soon'), false, names)).toBe('due soon or followup soon')
  })

  it('refuses `soon` after any other date word', () => {
    expect(errorOf('planned soon')).toBe('soon goes with due or followup')
    expect(errorOf('created soon')).toBe('soon goes with due or followup')
  })

  it('`stale` ends a text phrase, as the other keywords do', () => {
    expect(errorOf('budget stale')).toBe('Add and / or before “stale”')
  })

  it('reads back in words', () => {
    const words = (text: string) => expressionWords(tree(text)!, names).text
    expect(words('(due soon or followup soon) and stale')).toBe('(due soon or follow-up soon) · stale')
    expect(words('stale')).toBe('Stale')
  })

  it('is no chip: Graphical can’t say it', () => {
    expect(expressionToClauses(tree('stale'))).toBeNull()
    expect(expressionToClauses(tree('due soon'))).toBeNull()
  })

  it('a stored expression with them reads back; a bad `soon` drops the expression', () => {
    const stored = { ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'soon', field: 'followup' }, { kind: 'stale' }] } }
    expect(pickPredicate(stored).predicate.expression).toEqual(stored.expression)
    const bad = { ...emptyPredicate(), expression: { kind: 'soon', field: 'planned' } }
    expect(pickPredicate(bad).predicate.expression).toBeUndefined()
  })

  it('a Number’s history and order know what they read', () => {
    const c = predicateToCriteria(withExpression(emptyPredicate(), tree('followup soon and stale'), false))
    expect([...filterHistoryFields(c)].sort()).toEqual(['followup', 'modified', 'state'])
    expect(numberOrderField(c).field).toBe('followup')
  })
})

describe('stale and soon: what they keep', () => {
  it('`stale`: untouched for Stale after or more; an open task only', () => {
    expect(passes('stale', makeTodo({ modifiedAt: day(-30) }))).toBe(true)
    expect(passes('stale', makeTodo({ modifiedAt: day(-29) }))).toBe(false)
    expect(passes('stale', makeTodo({ modifiedAt: day(-90), isCompleted: true }))).toBe(false)
  })

  it('`stale` keeps nothing while Stale after is 0 (off)', () => {
    const off = settings({ staleAfterDays: 0 })
    expect(passes('stale', makeTodo({ modifiedAt: day(-300) }), off)).toBe(false)
    expect(passes('not stale', makeTodo({ modifiedAt: day(-300) }), off)).toBe(true)
  })

  it('`due soon`: late, or within the due-soon range; no due date never', () => {
    expect(passes('due soon', makeTodo({ dueDate: day(-5) }))).toBe(true)
    expect(passes('due soon', makeTodo({ dueDate: day(3) }))).toBe(true)
    expect(passes('due soon', makeTodo({ dueDate: day(4) }))).toBe(false)
    expect(passes('due soon', makeTodo({}))).toBe(false)
    // The range off: only a late date is soon.
    const off = settings({ urgentRange: null })
    expect(passes('due soon', makeTodo({ dueDate: day(-1) }), off)).toBe(true)
    expect(passes('due soon', makeTodo({ dueDate: day(0) }), off)).toBe(false)
  })

  it('`followup soon` reads the next follow-up, not the due date', () => {
    expect(passes('followup soon', makeTodo({ nextFollowupAt: day(1) }))).toBe(true)
    expect(passes('followup soon', makeTodo({ dueDate: day(1) }))).toBe(false)
    expect(passes('followup soon', makeTodo({ nextFollowupAt: day(10) }))).toBe(false)
  })

  it('follows the settings as they change: the same filter, other settings', () => {
    const todo = makeTodo({ modifiedAt: day(-20), dueDate: day(6) })
    const text = 'due soon and stale'
    expect(passes(text, todo, settings())).toBe(false)
    expect(passes(text, todo, settings({ staleAfterDays: 14, urgentRange: 7 }))).toBe(true)
  })

  it('currentFilterSettings reads Stale after as it is now', async () => {
    await useSettingsStore.getState().setStaleAfterDays(14)
    expect(currentFilterSettings().staleAfterDays).toBe(14)
    await useSettingsStore.getState().setStaleAfterDays(0)
    expect(currentFilterSettings().staleAfterDays).toBe(0)
  })
})
