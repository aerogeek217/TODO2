import { describe, expect, it } from 'vitest'
import { upgradeV75 } from '../../data/upgrades/v75-filter-expressions'
import { upgradeDataSet, type DataRow } from '../../data/schema-upgrades'

const EMPTY = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
const list = (predicate: Record<string, unknown>): DataRow => ({ id: 1, name: 'L', membership: { kind: 'custom', predicate } })
const predicateOf = (rows: DataRow[] | undefined) => ((rows?.[0]?.membership as Record<string, unknown>).predicate as Record<string, unknown>)

const today = { kind: 'relative', token: 'today' }

describe('v75 — filters Graphical can’t say become expressions', () => {
  it('an or group: the clauses outside it ANDed, the group an or of its clauses', () => {
    const before = {
      ...EMPTY,
      showCompleted: true,
      statusIds: [2],
      negate: { statusIds: true },
      orGroups: [{ ...EMPTY, markers: [{ values: ['focus'] }], personIds: [1, 3], dates: { deadline: { match: 'range', start: today, end: null, includeNoDate: true } } }],
    }
    const out = predicateOf(upgradeV75({ listDefinitions: [list(before)] }).listDefinitions)
    expect(out).toEqual({
      ...EMPTY,
      showCompleted: true,
      expression: {
        kind: 'and',
        items: [
          { kind: 'not', item: { kind: 'status', id: 2 } },
          {
            kind: 'or',
            items: [
              { kind: 'priority', value: 'focus' },
              { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 3 }] },
              { kind: 'or', items: [{ kind: 'date', field: 'deadline', match: { match: 'range', start: today, end: null } }, { kind: 'date', field: 'deadline', match: { match: 'unset' } }] },
            ],
          },
        ],
      },
    })
  })

  it('several Priority conditions beside an or group: one term each', () => {
    const out = predicateOf(upgradeV75({ listDefinitions: [list({ ...EMPTY, markers: [{ values: ['urgent', 'focus'] }, { values: ['important'], not: true }], orGroups: [{ ...EMPTY, tags: [1] }] })] }).listDefinitions)
    expect(out.markers).toBeNull()
    expect(out.expression).toEqual({
      kind: 'and',
      items: [
        { kind: 'or', items: [{ kind: 'priority', value: 'urgent' }, { kind: 'priority', value: 'focus' }] },
        { kind: 'not', item: { kind: 'priority', value: 'important' } },
        { kind: 'tag', id: 1 },
      ],
    })
  })

  it('several Priority conditions alone stay chips (Graphical repeats Priority)', () => {
    const data = { listDefinitions: [list({ ...EMPTY, markers: [{ values: ['urgent'] }, { values: ['important'], not: true }] })] }
    expect(upgradeV75(data)).toBe(data)
  })

  it('an "is not" date range in a group is a not', () => {
    const range = { match: 'range', start: { kind: 'offset', days: -7 }, end: today }
    const out = predicateOf(upgradeV75({ listDefinitions: [list({ ...EMPTY, orGroups: [{ ...EMPTY, dates: { lastFollowup: { ...range, not: true } }, searchText: ' plan ' }] })] }).listDefinitions)
    expect(out.expression).toEqual({
      kind: 'or',
      items: [{ kind: 'not', item: { kind: 'date', field: 'lastFollowup', match: range } }, { kind: 'text', text: 'plan' }],
    })
  })

  it('leaves what Graphical says as it is, and runs twice to the same', () => {
    const data = { listDefinitions: [list({ ...EMPTY, markers: [{ values: ['focus'] }], personIds: [1] })] }
    expect(upgradeV75(data)).toBe(data)
    const grouped = { listDefinitions: [list({ ...EMPTY, orGroups: [{ ...EMPTY, tags: [4] }, { ...EMPTY, personIds: [2] }] })] }
    const once = upgradeV75(grouped)
    expect(upgradeV75(once)).toBe(once)
  })

  it('passes a filter it can’t read through for validation', () => {
    const data = { listDefinitions: [list({ ...EMPTY, orGroups: [{ ...EMPTY, personIds: 'x' }] })] }
    expect(upgradeV75(data)).toBe(data)
  })

  it('converts the lenses, the Eisenhower panes and the check-in filter too', () => {
    const grouped = { ...EMPTY, orGroups: [{ ...EMPTY, tags: [4] }, { ...EMPTY, personIds: [2] }] }
    const out = upgradeV75({
      settings: [
        { key: 'lenses', value: JSON.stringify([{ id: 'a', name: 'A', predicate: grouped }]) },
        { key: 'eisenhowerPanes', value: JSON.stringify({ do: { name: 'Do', filter: grouped } }) },
        { key: 'checkinTaskFilter', value: JSON.stringify(grouped) },
        { key: 'theme', value: 'dark' },
      ],
    }).settings ?? []
    const value = (key: string) => JSON.parse(out.find((r) => r.key === key)?.value as string) as Record<string, unknown>
    const expected = { kind: 'and', items: [{ kind: 'tag', id: 4 }, { kind: 'person', id: 2 }] }
    expect((value('lenses') as unknown as Array<{ predicate: { expression: unknown } }>)[0]?.predicate.expression).toEqual(expected)
    expect(((value('eisenhowerPanes').do as Record<string, unknown>).filter as Record<string, unknown>).expression).toEqual(expected)
    expect(value('checkinTaskFilter').expression).toEqual(expected)
    expect(out.find((r) => r.key === 'theme')?.value).toBe('dark')
  })

  it('runs as the registry’s step 75', () => {
    const out = upgradeDataSet({ listDefinitions: [list({ ...EMPTY, markers: [{ values: ['urgent'] }], orGroups: [{ ...EMPTY, personIds: [1] }] })] }, 74, 75)
    expect(predicateOf(out.listDefinitions).expression).toEqual({ kind: 'and', items: [{ kind: 'priority', value: 'urgent' }, { kind: 'person', id: 1 }] })
  })
})
