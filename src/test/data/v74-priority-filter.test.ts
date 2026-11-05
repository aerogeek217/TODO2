import { describe, expect, it } from 'vitest'
import { upgradeV74 } from '../../data/upgrades/v74-priority-filter'
import { pickPredicate } from '../../data/predicate-shape'
import { CURRENT_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, type DataRow } from '../../data/schema-upgrades'
import { emptyFilterClauses, emptyPredicate, OR_GROUPS_MAX, type TodoPredicate } from '../../models'
import { matchesFilterWithLookups } from '../../utils/filter-match'
import { predicateToCriteria } from '../../utils/filter-criteria'

const list = (predicate: unknown): DataRow => ({ id: 1, name: 'L', membership: { kind: 'custom', predicate } })
const upgraded = (predicate: unknown, settings?: DataRow[]) => {
  const out = upgradeV74({ listDefinitions: [list(predicate)], ...(settings ? { settings } : {}) })
  return (out.listDefinitions?.[0]?.membership as { predicate: TodoPredicate }).predicate
}
const legacy = (markers: unknown) => ({ ...emptyPredicate(), markers })

describe('upgradeV74 — a stored Priority filter as conditions', () => {
  it('is registered as the current step', () => {
    expect(SCHEMA_UPGRADES.get(74)).toBe(upgradeV74)
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(74)
  })

  it('a Yes marker is a chip each; the No markers go together', () => {
    expect(upgraded(legacy({ urgent: true, important: true })).markers).toEqual([{ values: ['urgent'] }, { values: ['important'] }])
    expect(upgraded(legacy({ important: true, urgent: false })).markers).toEqual([{ values: ['important'] }, { values: ['urgent'], not: true }])
    expect(upgraded(legacy({ urgent: false, important: false })).markers).toEqual([{ values: ['urgent', 'important'], not: true }])
    expect(upgraded(legacy({})).markers).toBeNull()
    expect(upgraded(legacy(null)).markers).toBeNull()
  })

  it('Hot is the default rule in conjunctive form, with no rule stored', () => {
    expect(upgraded(legacy('hot')).markers).toEqual([{ values: ['focus', 'urgent'] }, { values: ['focus', 'important'] }])
  })

  it('Hot reads the stored rule', () => {
    const rule = (lines: unknown[]) => [{ key: 'hotRule', value: JSON.stringify(lines) }]
    expect(upgraded(legacy('hot'), rule([{ focus: true }])).markers).toEqual([{ values: ['focus'] }])
    expect(upgraded(legacy('hot'), rule([{ urgent: true }, { important: true }])).markers).toEqual([{ values: ['urgent', 'important'] }])
    expect(upgraded(legacy('hot'), rule([{ urgent: true, important: true }])).markers).toEqual([{ values: ['urgent'] }, { values: ['important'] }])
    expect(upgraded(legacy('hot'), [{ key: 'hotRule', value: 'not json' }]).markers).toEqual([{ values: ['focus', 'urgent'] }, { values: ['focus', 'important'] }])
  })

  it('an AND in an or group distributes over its other clauses', () => {
    const group = { ...emptyFilterClauses(), personIds: [1], markers: { urgent: true, important: true } }
    expect(upgraded({ ...emptyPredicate(), orGroups: [group] }).orGroups).toEqual([
      { ...group, markers: [{ values: ['urgent'] }] },
      { ...group, markers: [{ values: ['important'] }] },
    ])
  })

  it('one condition in a group stays one group', () => {
    const group = { ...emptyFilterClauses(), personIds: [1], markers: { urgent: false, important: false } }
    expect(upgraded({ ...emptyPredicate(), orGroups: [group] }).orGroups).toEqual([
      { ...group, markers: [{ values: ['urgent', 'important'], not: true }] },
    ])
  })

  it('the most a v73 filter can need fits the cap, so nothing is lost when read', () => {
    const groups = Array.from({ length: 10 }, (_, i) => ({ ...emptyFilterClauses(), tags: [i], markers: { focus: true, urgent: true, important: true } }))
    const up = upgraded({ ...emptyPredicate(), orGroups: groups })
    expect(up.orGroups).toHaveLength(30)
    expect(OR_GROUPS_MAX).toBeGreaterThanOrEqual(30)
    expect(pickPredicate(up).fixes).toEqual([])
    expect(pickPredicate(up).predicate.orGroups).toHaveLength(30)
  })

  it('converts lenses, Eisenhower panes and the check-in filter', () => {
    const settings: DataRow[] = [
      { key: 'lenses', value: JSON.stringify([{ id: 'a', name: 'A', predicate: legacy({ focus: true }) }]) },
      { key: 'eisenhowerPanes', value: JSON.stringify({ do: { name: 'X' }, drop: { filter: legacy({ urgent: true }) } }) },
      { key: 'checkinTaskFilter', value: JSON.stringify(legacy({ important: false })) },
      { key: 'theme', value: 'dark' },
    ]
    const out = upgradeV74({ settings }).settings ?? []
    const value = (key: string) => JSON.parse(out.find((r) => r.key === key)?.value as string)
    expect(value('lenses')[0].predicate.markers).toEqual([{ values: ['focus'] }])
    expect(value('eisenhowerPanes').do).toEqual({ name: 'X' })
    expect(value('eisenhowerPanes').drop.filter.markers).toEqual([{ values: ['urgent'] }])
    expect(value('checkinTaskFilter').markers).toEqual([{ values: ['important'], not: true }])
    expect(out.find((r) => r.key === 'theme')?.value).toBe('dark')
  })

  it('is idempotent', () => {
    const once = upgradeV74({ listDefinitions: [list(legacy('hot'))], settings: [{ key: 'lenses', value: JSON.stringify([{ predicate: legacy({ focus: true }) }]) }] })
    expect(upgradeV74(once)).toEqual(once)
  })

  it('tolerates missing tables and malformed rows, leaving what it can\'t read for validation', () => {
    expect(upgradeV74({})).toEqual({})
    const rows: DataRow[] = [{ id: 1 }, { id: 2, membership: 5 }, list(null), list(legacy('warm')), list(legacy({ warm: true }))]
    const out = upgradeV74({ listDefinitions: rows }).listDefinitions ?? []
    expect(out[0]).toEqual(rows[0])
    expect(out[1]).toEqual(rows[1])
    expect((out[3]?.membership as { predicate: { markers: unknown } }).predicate.markers).toBe('warm')
    expect(pickPredicate((out[3]?.membership as { predicate: unknown }).predicate).fixes).toContain('priority filter dropped')
    const bad: DataRow[] = [{ key: 'lenses', value: '{not json' }, { key: 'eisenhowerPanes', value: 5 }]
    expect(upgradeV74({ settings: bad }).settings).toEqual(bad)
  })

  it('a filter keeps exactly the tasks it matched', () => {
    const settings = { urgentRange: null, hotRule: [{ urgent: true, important: true }, { focus: true }], weekStartsOn: 0 } as const
    const flags = [false, true]
    const tasks = flags.flatMap((focus) => flags.flatMap((urgent) => flags.map((important) => ({ focus, urgent, important }))))
    const legacyHot = (t: { focus: boolean; urgent: boolean; important: boolean }) => t.focus || (t.urgent && t.important)
    const keeps = (predicate: TodoPredicate) => {
      const criteria = predicateToCriteria(pickPredicate(predicate).predicate)
      return tasks.map((t, i) => matchesFilterWithLookups(criteria, { id: i + 1, title: 't', isCompleted: false, ...t } as never, {}, new Date(2026, 0, 1), settings))
    }
    expect(keeps(upgraded(legacy('hot')))).toEqual(tasks.map(legacyHot))
    expect(keeps(upgraded(legacy({ urgent: true, important: false })))).toEqual(tasks.map((t) => t.urgent && !t.important))
    expect(keeps(upgraded(legacy({ urgent: false, focus: false })))).toEqual(tasks.map((t) => !t.urgent && !t.focus))
    // `(U & I) or text`: the group distributes, and text matches no task here.
    const grouped = { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), searchText: 'zzz', markers: { urgent: true, important: true } }] }
    expect(keeps(upgraded(grouped))).toEqual(tasks.map((t) => t.urgent && t.important))
    // A group that was only Priority's AND.
    const only = { ...emptyPredicate(), orGroups: [{ ...emptyFilterClauses(), markers: 'hot' }] }
    expect(keeps(upgraded(only))).toEqual(tasks.map(legacyHot))
  })
})
