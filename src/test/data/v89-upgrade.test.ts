import { describe, expect, it } from 'vitest'
import { upgradeV89 } from '../../data/upgrades/v89'
import { upgradeV88 } from '../../data/upgrades/v88'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyPredicate } from '../../models/filter-predicate'
import type { LayoutBody, LayoutTab } from '../../models/workspace-layout'
import { cell, grid, numberItem } from '../helpers/layout-builders'

/**
 * v89 — a task's plan state is a planned day or none: `unplanned` goes from
 * every task, and Planned's `held` clause (held in Unplanned, the
 * expression's `unplanned`) goes from every stored predicate — a list's, a
 * layout tab's config, the `checkinTaskFilter` setting's JSON. The
 * transform's own tests, then the pipeline.
 */

type Obj = Record<string, unknown>

const DATE = '2026-11-23T09:00:00.000Z'
const HELD = { match: 'held' }
const RANGE = { match: 'range', start: { kind: 'relative', token: 'today' }, end: null }
/** Expression atoms, as stored. */
const heldAtom = { kind: 'date', field: 'planned', match: HELD }
const anyAtom = { kind: 'date', field: 'planned', match: { match: 'set' } }
const focus = { kind: 'priority', value: 'focus' }
const tag = { kind: 'tag', id: 4 }

const task = (extra: Obj = {}): DataRow => ({ id: 1, uid: 'u1', title: 'Call', isCompleted: false, sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...extra })
const predicate = (extra: Obj = {}): Obj => ({ ...emptyPredicate(), ...extra })
const list = (pred: Obj, extra: Obj = {}): DataRow => ({
  id: 5, name: 'Planned', sortOrder: 0, membership: { kind: 'custom', predicate: pred }, sort: 'planned', grouping: 'planned', owner: { layoutId: 1 }, ...extra,
})
const predicateOf = (row: DataRow | undefined): Obj => (row?.membership as { predicate: Obj }).predicate
const layout = (body: LayoutBody, extra: Obj = {}): DataRow => ({ id: 1, name: 'L', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body, ...extra })
const raw = (tab: Obj): LayoutTab => tab as unknown as LayoutTab
const planner = (id: string, unplanned: Obj): LayoutTab => raw({ id, kind: 'planner', config: { unplanned } })
const tabsOf = (row: DataRow | undefined) => (row as unknown as LayoutBody).cells.flatMap((c) => c.tabs) as unknown as Obj[]
const checkin = (pred: Obj): DataRow => ({ key: 'checkinTaskFilter', value: JSON.stringify(pred) })

/** One list's predicate through the step. */
const upgradePredicate = (pred: Obj): Obj => predicateOf(upgradeV89({ listDefinitions: [list(pred)] }).listDefinitions?.[0])

describe('v89: registered', () => {
  it('is registered above the floor, at or below the current version', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(89)
    expect(OLDEST_SUPPORTED_DB_VERSION).toBe(87)
    expect(SCHEMA_UPGRADES.get(89)).toBe(upgradeV89)
  })
})

describe('v89: tasks lose `unplanned`', () => {
  it('a held task comes back without it, its other fields kept; a planned day stays', () => {
    const held = task({ nextFollowupAt: DATE, unplanned: true })
    const both = task({ id: 2, doDate: DATE, unplanned: true })
    const out = upgradeV89({ todos: [held, both] })
    expect(out.todos?.[0]).toEqual(task({ nextFollowupAt: DATE }))
    expect('unplanned' in out.todos![0]!).toBe(false)
    expect(out.todos?.[1]).toEqual(task({ id: 2, doDate: DATE }))
  })

  it('any value of it goes; a task without it comes back as the same object', () => {
    const plain = task({ id: 3, doDate: DATE })
    const out = upgradeV89({ todos: [task({ unplanned: false }), task({ id: 2, unplanned: null }), plain] })
    expect(out.todos?.map((t) => 'unplanned' in t)).toEqual([false, false, false])
    expect(out.todos?.[2]).toBe(plain)
  })
})

describe('v89: Planned’s `held` clause goes from a predicate', () => {
  it('a graphical `dates.planned: held` is deleted; the other date clauses stay as they are', () => {
    const out = upgradePredicate(predicate({ dates: { planned: HELD, deadline: RANGE, followup: { match: 'unset' } } }))
    expect(out.dates).toEqual({ deadline: RANGE, followup: { match: 'unset' } })
  })

  it('`planned any or unplanned` reads `planned any`', () => {
    expect(upgradePredicate(predicate({ expression: { kind: 'or', items: [anyAtom, heldAtom] } })).expression).toEqual(anyAtom)
  })

  it('`held` in an `and` with one other item leaves that item; with several, the `and` keeps the rest', () => {
    expect(upgradePredicate(predicate({ expression: { kind: 'and', items: [heldAtom, focus] } })).expression).toEqual(focus)
    expect(upgradePredicate(predicate({ expression: { kind: 'and', items: [focus, heldAtom, tag] } })).expression)
      .toEqual({ kind: 'and', items: [focus, tag] })
  })

  it('a `not` of it goes, from deep inside too', () => {
    expect(upgradePredicate(predicate({ expression: { kind: 'and', items: [focus, { kind: 'not', item: heldAtom }] } })).expression).toEqual(focus)
    const nested = { kind: 'or', items: [tag, { kind: 'not', item: { kind: 'or', items: [heldAtom, focus] } }] }
    expect(upgradePredicate(predicate({ expression: nested })).expression).toEqual({ kind: 'or', items: [tag, { kind: 'not', item: focus }] })
  })

  it('an expression left with nothing is deleted, the rest of the predicate kept', () => {
    for (const expression of [heldAtom, { kind: 'not', item: heldAtom }, { kind: 'or', items: [heldAtom, { kind: 'not', item: heldAtom }] }]) {
      const out = upgradePredicate(predicate({ searchText: 'call', expression }))
      expect('expression' in out, JSON.stringify(expression)).toBe(false)
      expect(out).toEqual(predicate({ searchText: 'call' }))
    }
  })

  it('other date clauses and atoms are left alone: a predicate with no `held` comes back as the same object', () => {
    const untouched = list(predicate({
      dates: { planned: { match: 'unset' }, deadline: RANGE },
      expression: { kind: 'or', items: [anyAtom, { kind: 'date', field: 'deadline', match: RANGE }, { kind: 'not', item: focus }] },
    }))
    const data: DataSet = { listDefinitions: [untouched] }
    expect(upgradeV89(data)).toBe(data)
  })

  it('a layout tab’s config at any depth: a Planner’s Unplanned filter, a Number’s filter', () => {
    const plain = layout(grid([[cell('a', [raw({ id: 'n', kind: 'notes', config: {} })])]]), { id: 2 })
    const out = upgradeV89({
      layouts: [
        layout(grid([[
          cell('a', [planner('p', predicate({ expression: { kind: 'or', items: [focus, heldAtom] } }))]),
          cell('b', [raw({ id: 'k', kind: 'number', config: { ...numberItem('k', 'open'), id: undefined, filter: predicate({ dates: { planned: HELD } }) } })]),
        ]])),
        plain,
      ],
    })
    const [p, k] = tabsOf(out.layouts?.[0])
    expect((p?.config as Obj).unplanned).toEqual(predicate({ expression: focus }))
    expect(((k?.config as Obj).filter as Obj).dates).toEqual({})
    expect(out.layouts?.[1]).toBe(plain)
  })

  it('the `checkinTaskFilter` setting’s JSON; other settings are the same rows', () => {
    const other = { key: 'staleAfterDays', value: '30' }
    const out = upgradeV89({ settings: [other, checkin(predicate({ dates: { planned: HELD }, expression: { kind: 'and', items: [heldAtom, tag] } }))] })
    expect(out.settings?.[0]).toBe(other)
    expect(JSON.parse(String(out.settings?.[1]?.value))).toEqual(predicate({ dates: {}, expression: tag }))
  })
})

describe('v89: the contract', () => {
  const full = (): DataSet => ({
    todos: [task({ nextFollowupAt: DATE, unplanned: true })],
    listDefinitions: [list(predicate({ expression: { kind: 'or', items: [anyAtom, heldAtom] } }))],
    layouts: [layout(grid([[cell('a', [planner('p', predicate({ dates: { planned: HELD } }))])]]))],
    settings: [checkin(predicate({ expression: { kind: 'and', items: [focus, heldAtom] } }))],
  })

  it('pure and idempotent: the input untouched; run again, the same object back', () => {
    const data = full()
    const before = JSON.parse(JSON.stringify(data)) as DataSet
    const once = upgradeV89(data)
    expect(data).toEqual(before)
    expect(once).not.toBe(data)
    for (const table of ['todos', 'listDefinitions', 'layouts', 'settings']) expect(once[table], table).not.toBe(data[table])
    expect(upgradeV89(once)).toBe(once)
  })

  it('a table with nothing to change is the same array; tables it never reads are passed through', () => {
    const todos: DataRow[] = [task({ doDate: DATE })]
    const settings: DataRow[] = [{ key: 'weekStartsOn', value: '1' }, checkin(predicate({ expression: focus }))]
    const notes: DataRow[] = [{ id: 1, content: 'held', createdAt: DATE, modifiedAt: DATE }]
    const out = upgradeV89({ todos, settings, notes, listDefinitions: [list(predicate({ dates: { planned: HELD } }))] })
    expect(out.todos).toBe(todos)
    expect(out.settings).toBe(settings)
    expect(out.notes).toBe(notes)
  })

  it('tolerates missing tables, malformed rows and a check-in filter that isn’t JSON (left for the repair)', () => {
    const empty: DataSet = {}
    expect(upgradeV89(empty)).toBe(empty)
    const odd: DataSet = {
      todos: [null as unknown as DataRow, 4 as unknown as DataRow],
      listDefinitions: [null as unknown as DataRow, { id: 2, membership: 'x' }, { id: 3, membership: { kind: 'custom', predicate: { dates: 'none', expression: { kind: 'or', items: 'x' } } } }],
      layouts: [null as unknown as DataRow, { id: 2, cells: 'none' }, { id: 3, cells: [null, { id: 'k', tabs: [null, 4, { kind: 'planner', config: null }] }] }],
      settings: [{ key: 'checkinTaskFilter', value: '{not json' }, { key: 'checkinTaskFilter', value: 7 }, { key: 'checkinTaskFilter', value: '"held"' }],
    }
    expect(upgradeV89(odd)).toBe(odd)
    const notTables = { todos: 'x', layouts: null } as unknown as DataSet
    expect(upgradeV89(notTables)).toBe(notTables)
  })
})

describe('v89 through the pipeline', () => {
  const v88File = () => ({
    [SCHEMA_VERSION_KEY]: 88,
    todos: [
      task({ nextFollowupAt: DATE, unplanned: true }),
      task({ id: 2, uid: 'u2', title: 'Quote', sortOrder: 1, doDate: DATE }),
    ],
    listDefinitions: [
      list(predicate({ dates: { planned: HELD, deadline: RANGE } })),
      list(predicate({ expression: { kind: 'or', items: [anyAtom, heldAtom] } }), { id: 6, name: 'Any plan', sortOrder: 1 }),
    ],
    layouts: [layout(grid([[
      cell('a', [
        raw({ id: 'l5', kind: 'lens', config: { listDefinitionId: 5 } }),
        raw({ id: 'l6', kind: 'lens', config: { listDefinitionId: 6 } }),
        planner('p', predicate({ expression: { kind: 'or', items: [focus, heldAtom] } })),
      ]),
    ]]))],
    settings: [checkin(predicate({ expression: { kind: 'and', items: [heldAtom, tag] } }))],
  })

  it('a v88 file with a held task and held filters imports with neither, and no warning', () => {
    const result = prepareImport(JSON.parse(JSON.stringify(v88File())))
    if (!result.ok) throw new Error(result.error)
    expect(result.upgraded).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.data.todos.map((t) => 'unplanned' in t)).toEqual([false, false])
    expect(result.data.todos[1]?.doDate).toEqual(new Date(DATE))
    const preds = (result.data.listDefinitions ?? []).map((d) => (d.membership.kind === 'custom' ? d.membership.predicate : undefined))
    expect(preds[0]?.dates).toEqual({ deadline: RANGE })
    expect(preds[0]?.expression).toBeUndefined()
    expect(preds[1]?.expression).toEqual(anyAtom)
    const tab = result.data.layouts[0]?.cells[0]?.tabs.find((t) => t.kind === 'planner')
    expect(tab?.kind === 'planner' ? tab.config.unplanned?.expression : undefined).toEqual(focus)
    const setting = result.data.settings.find((r) => r.key === 'checkinTaskFilter')
    expect((JSON.parse(setting?.value ?? '{}') as Obj).expression).toEqual(tag)
  })

  it('the registry runs v88 and v89 from v87', () => {
    const v87 = { ...v88File(), [SCHEMA_VERSION_KEY]: 87, layouts: [layout(grid([[cell('a', [raw({ id: 'w', kind: 'listwall', config: {} }), planner('p', predicate({ dates: { planned: HELD } }))])]]))] }
    const data = JSON.parse(JSON.stringify(v87)) as DataSet
    const chained = upgradeDataSet(data, 87, CURRENT_DB_VERSION)
    expect(chained).toEqual(upgradeV89(upgradeV88(data)))
    const [board, p] = tabsOf(chained.layouts?.[0])
    expect(board).toEqual({ id: 'w', kind: 'shortcuts', config: { source: 'layout' } })
    expect((p?.config as Obj).unplanned).toEqual(predicate({ dates: {} }))
    expect(chained.todos?.map((t) => 'unplanned' in t)).toEqual([false, false])
  })
})
