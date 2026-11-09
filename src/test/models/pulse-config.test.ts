import { describe, expect, it } from 'vitest'
import type { PersistedTodoItem, Tag } from '../../models'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import {
  pickPulseConfig,
  pulseConfigProblem,
  pulseLateDefaultFilter,
  pulseRuleName,
  pulseRuleOf,
  pulseRulePredicates,
  pulseStaleFilterFor,
} from '../../models/pulse-config'
import type { PickedConfig } from '../../models/glance-widgets'
import { computePulse } from '../../services/stats/pulse'
import { clausesToExpression, parseExpression, printExpression } from '../../utils/filter-expression'
import { predicateToCriteria } from '../../utils/filter-criteria'
import { matchesFilterWithLookups, type FilterSettings } from '../../utils/filter-match'
import { makeTodo, testLookups } from '../helpers'

/**
 * Project pulse's rules (G5): a config without them reads as the defaults
 * — late due before today, stale by Settings' threshold — and the filters a
 * rule starts from keep exactly the tasks the defaults do, so the first
 * edit changes no count.
 */

const today = new Date(2026, 10, 11, 10) // Wed 11 Nov
const day = (n: number) => new Date(2026, 10, 11 + n, 9)
const OLD = new Date(2026, 0, 1)
const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }

function task(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return makeTodo({ createdAt: OLD, modifiedAt: day(0), ...overrides })
}

/** Due and modified dates around today's edges: yesterday late at night, today early, 30 and 31 days back, none. */
const FIXTURE: PersistedTodoItem[] = [
  task({ id: 1, dueDate: new Date(2026, 10, 10, 23, 59) }),
  task({ id: 2, dueDate: new Date(2026, 10, 11, 0, 1) }),
  task({ id: 3, dueDate: day(-30), modifiedAt: new Date(2026, 9, 12, 23, 30) }), // 30 days back
  task({ id: 4, dueDate: day(5), modifiedAt: new Date(2026, 9, 13, 0, 30) }), // 29 days back
  task({ id: 5, modifiedAt: day(-31) }),
  task({ id: 6, dueDate: day(-2), modifiedAt: day(-90) }),
  task({ id: 7 }),
]
const MAP = new Map(FIXTURE.map((t) => [t.id, [ATLAS]]))
const ctx = { today, weekStartsOn: 0 as const, assignedTagsMap: MAP }
const SETTINGS: FilterSettings = { urgentRange: 3, weekStartsOn: 0 }

/** A filter as a pulse rule's matcher (as the widget's hook builds it). */
function matcher(filter: TodoPredicate) {
  const criteria = predicateToCriteria(filter)
  const lookups = testLookups({ assignedTagsMap: MAP })
  return (t: PersistedTodoItem) => matchesFilterWithLookups(criteria, t, lookups, today, SETTINGS)
}

const read = (raw: unknown): PickedConfig<TodoPredicate> => ({ config: raw as TodoPredicate, fixed: false })

describe('the default rules', () => {
  it('Late’s default filter is `overdue` and keeps exactly what the built-in late does', () => {
    const builtIn = computePulse(FIXTURE, [ATLAS], ctx, [1], 30)[0]!
    const viaFilter = computePulse(FIXTURE, [ATLAS], ctx, [1], 30, { late: matcher(pulseLateDefaultFilter()) })[0]!
    expect(builtIn.lateIds).toEqual([3, 6, 1])
    expect(viaFilter.lateIds).toEqual(builtIn.lateIds)
    expect(viaFilter.lateShare).toBe(builtIn.lateShare)
    const names = { person: () => undefined, tag: () => undefined, status: () => undefined }
    expect(printExpression(clausesToExpression(pulseLateDefaultFilter()), false, names)).toBe('overdue')
  })

  it('Stale’s first filter (modified on or before N days ago) keeps exactly what Settings’ threshold does', () => {
    for (const days of [1, 29, 30, 31, 90]) {
      const builtIn = computePulse(FIXTURE, [ATLAS], ctx, [1], days)[0]!
      const viaFilter = computePulse(FIXTURE, [ATLAS], ctx, [1], days, { stale: matcher(pulseStaleFilterFor(days)) })[0]!
      expect(viaFilter.staleCount, `${days} days`).toBe(builtIn.staleCount)
    }
    expect(computePulse(FIXTURE, [ATLAS], ctx, [1], 30)[0]!.staleCount).toBe(3)
  })

  it('custom rules: late and stale by their filters within a card’s open tasks; the ring follows Late', () => {
    const parse = (text: string): TodoPredicate => {
      const r = parseExpression(text, { today, names: { person: () => undefined, tag: () => undefined, status: () => undefined } })
      if (!r.ok) throw new Error(r.error.message)
      return { ...emptyPredicate(), expression: r.expression ?? undefined }
    }
    const tasks = [...FIXTURE, task({ id: 8, dueDate: day(-1), isCompleted: true, completedAt: day(0) })]
    const map = new Map(tasks.map((t) => [t.id, [ATLAS]]))
    const [card] = computePulse(tasks, [ATLAS], { ...ctx, assignedTagsMap: map }, [1], 30, {
      late: matcher(parse('due within next 5 days')),
      stale: matcher(parse('no due')),
    })
    expect(card!.openIds).toHaveLength(7)
    // Due today … today + 5: 2 and 4 (the completed 8 isn't open).
    expect(card!.lateIds).toEqual([2, 4])
    expect(card!.lateShare).toBeCloseTo(2 / 7)
    expect(card!.staleCount).toBe(2)
  })
})

describe('the config’s rules', () => {
  it('names: its own, else the default (blank too); a rule at its default is written as none', () => {
    expect(pulseRuleName({}, 'late')).toBe('late')
    expect(pulseRuleName({ stale: { name: '  ' } }, 'stale')).toBe('stale')
    expect(pulseRuleName({ late: { name: 'Blocked' } }, 'late')).toBe('Blocked')
    expect(pulseRuleOf('late', 'late', undefined)).toBeUndefined()
    expect(pulseRuleOf('stale', '', undefined)).toEqual({ name: '' })
    expect(pulseRuleOf('stale', 'Quiet', undefined)).toEqual({ name: 'Quiet' })
    expect(pulseRuleOf('late', 'late', emptyPredicate())).toEqual({ name: 'late', filter: emptyPredicate() })
  })

  it('a stored config: its rules kept; a bad rule dropped, a bad name the default, a filter that isn’t an object dropped — each a fix', () => {
    const filter = pulseLateDefaultFilter()
    const good = { tagIds: [1], late: { name: 'Behind', filter }, stale: { name: 'Quiet' } }
    expect(pulseConfigProblem(good)).toBeNull()
    expect(pulseRulePredicates(good)).toEqual([['late.filter', filter]])
    expect(pickPulseConfig({ ...good, extra: 1 }, read)).toEqual({ config: good, fixed: false })

    expect(pulseConfigProblem({ tagIds: [1], late: 'x' })).toBe('late')
    expect(pickPulseConfig({ tagIds: [1], late: 'x' }, read)).toEqual({ config: { tagIds: [1] }, fixed: true })
    expect(pulseConfigProblem({ tagIds: [1], stale: { name: 4 } })).toBe('stale.name')
    expect(pickPulseConfig({ tagIds: [1], stale: { name: 'x'.repeat(81) } }, read)).toEqual({ config: { tagIds: [1], stale: { name: 'stale' } }, fixed: true })
    expect(pickPulseConfig({ tagIds: [1], late: { name: 'L', filter: 3 } }, read)).toEqual({ config: { tagIds: [1], late: { name: 'L' } }, fixed: true })
    expect(pulseConfigProblem({ tagIds: 'x' })).toBe('tagIds')
    // A filter the reader repairs is a fix.
    expect(pickPulseConfig({ tagIds: [], late: { name: 'L', filter: {} } }, () => ({ config: emptyPredicate(), fixed: true })).fixed).toBe(true)
  })
})
