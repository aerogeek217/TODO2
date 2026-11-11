import { describe, it, expect, beforeEach } from 'vitest'
import type { Table } from 'dexie'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { IMPORT_TABLES, type ImportData } from '../../data/import-validation'
import { DATA_TABLE_NAMES } from '../../data/tables'
import { ALL_SETTING_KEYS } from '../../data/setting-keys'
import { prepareImportText } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { buildExportData } from '../../data/export-data'
import { NEGATABLE_FIELDS, emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import type { FilterExpr } from '../../models/filter-expression'
import { expressionAtoms } from '../../utils/filter-expression'
import { DATE_FIELD_VALUES } from '../../models/app-view'
import { TODO_EVENT_TYPES } from '../../models/todo-event'
import { WIDGET_KINDS } from '../../models/workspace-layout'
import { formatCheckinFilterSetting } from '../../data/checkin-filter-shape'
import { formatLensesSetting } from '../../data/lens-shape'
import { makeTodo, resetDb } from '../helpers'
import { cell, emptyBody, grid, numberTab } from '../helpers/layout-builders'

/**
 * Export → JSON → import round-trip guarantee.
 *
 * Seeds every data table with rows that populate **every model field** (incl.
 * nested shapes), exports with `buildExportData`, serializes to JSON, runs the
 * unified import (`prepareImportText` → `restoreFromImportData`), and
 * requires every table to come back deep-equal to the seed — with a real
 * `Date` wherever the seed has one.
 *
 * This is the runtime guard against `pick*` drift in
 * `data/import-validation.ts` (the compile-time half is `AllFields<Model>` on
 * each picker). **When you add a model field, populate it in `SEED` below** —
 * the coverage test fails until you do.
 */

type SeedRow<K extends keyof ImportData> = NonNullable<ImportData[K]>[number]
type Seed = { [K in keyof ImportData]-?: Array<SeedRow<K>> }

const at = (iso: string) => new Date(iso)

const FULL_PREDICATE: TodoPredicate = {
  showCompleted: true,
  personIds: [1, 0],
  statusIds: [1, 2],
  searchText: 'invoice',
  dates: {
    deadline: { match: 'range', start: { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' }, end: { kind: 'offset', days: 30 }, includeNoDate: true },
    followup: { match: 'unset' },
    lastFollowup: { match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true },
    completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'today' } },
    created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null },
    modified: { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'relative', token: 'today' }, not: true },
  },
  markers: [{ values: ['urgent', 'important'] }],
  tags: [1],
}

/** An expression in its stored form: every kind of atom, an `or`, `not`s (of an atom and of an `or`). */
const EXPRESSION: FilterExpr = {
  kind: 'and',
  items: [
    { kind: 'or', items: [
      { kind: 'person', id: 2 },
      { kind: 'text', text: 'call' },
      { kind: 'date', field: 'followup', match: { match: 'range', start: { kind: 'relative', token: 'today' }, end: null } },
      { kind: 'priority', value: 'focus' },
      { kind: 'tag', id: 0 },
    ] },
    { kind: 'not', item: { kind: 'or', items: [{ kind: 'status', id: 1 }, { kind: 'status', id: 0 }] } },
    { kind: 'not', item: { kind: 'priority', value: 'urgent' } },
  ],
}

/** The check-in's: no person, no Completed range (a check-in drops them). */
const CHECKIN_EXPRESSION: FilterExpr = { kind: 'or', items: [{ kind: 'priority', value: 'focus' }, { kind: 'not', item: { kind: 'tag', id: 1 } }] }

function buildSeed(): Seed {
  return {
    todos: [
      {
        id: 1, uid: '0b6f3c2e-1d4a-4c8e-9f21-7a5b3c9d1e01', title: 'Send quarterly report', notes: 'Include **charts**',
        isCompleted: false,
        dueDate: at('2026-10-16T00:00:00.000Z'),
        lastFollowupAt: at('2026-09-13T14:25:31.000Z'),
        nextFollowupAt: at('2026-10-13T00:00:00.000Z'),
        recurrenceRule: { type: 'monthly', originalDayOfMonth: 31 },
        focus: true,
        urgent: true,
        important: true,
        createdAt: at('2026-09-02T10:00:00.000Z'), modifiedAt: at('2026-09-11T09:30:00.000Z'),
        statusId: 2, sortOrder: 0,
      },
      {
        id: 2, uid: '0b6f3c2e-1d4a-4c8e-9f21-7a5b3c9d1e02', title: 'Book dentist', isCompleted: true,
        completedAt: at('2026-09-10T09:30:00.000Z'),
        createdAt: at('2026-09-03T11:00:00.000Z'), modifiedAt: at('2026-09-10T09:30:00.000Z'),
        sortOrder: 1,
      },
    ],
    people: [{ id: 1, name: 'Ann Lee', initials: 'AL', color: '#e05050', email: 'ann.lee@example.com' }],
    tags: [{ id: 1, name: 'urgent', color: '#ff0000' }],
    todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
    todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
    settings: [
      { key: 'seededAssignedStatusId', value: '1' },
      { key: 'weekStartsOn', value: '1' },
      { key: 'followupDefaultInterval', value: '2w' },
      { key: 'newTaskFollowup', value: 'false' },
      { key: 'removeConvertedLines', value: 'true' },
      { key: 'tabBadgeDue', value: 'overdue' },
      { key: 'tabBadgeFollowup', value: '7' },
      { key: 'priorityCues', value: JSON.stringify({ focus: { glow: true, semibold: false }, urgent: { glow: false, semibold: false }, important: { glow: true, semibold: true } }) },
      { key: 'urgentDueWithinDays', value: 'off' },
      { key: 'checkinOpenMethod', value: 'eml' },
      { key: 'checkinTaskFilter', value: formatCheckinFilterSetting({ ...emptyPredicate(), expression: CHECKIN_EXPRESSION }) },
      { key: 'newListSort', value: 'deadline' },
      { key: 'newListSortDirection', value: 'desc' },
      { key: 'newListGroup', value: 'tag' },
      { key: 'purgePromptIntervalDays', value: '14' },
      { key: 'purgePromptLastAt', value: '2026-09-14T08:30:00.000Z' },
      { key: 'historyLogSince', value: '2026-09-01T07:00:00.000Z' },
      { key: 'staleAfterDays', value: '45' },
      { key: 'rowDensity', value: 'comfortable' },
      { key: 'rowDates', value: 'numeric' },
      { key: 'ambience', value: JSON.stringify({ enabled: false, place: { lat: 41.88, lon: -87.63 }, sky: 'subtle', motion: 60, seasons: false }) },
      { key: 'lenses', value: formatLensesSetting([{ id: 'lens-a', name: 'This month', predicate: { ...emptyPredicate(), expression: EXPRESSION } }]) },
      { key: 'lensPresetsSeeded', value: 'true' },
      { key: 'activeLensId', value: 'lens-a' },
      { key: 'themeMode', value: 'dark' },
      { key: 'defaultStatusId', value: '2' },
      { key: 'completedRetentionDays', value: '30' },
      { key: 'color.dark.accent', value: '#4f8cff' },
      { key: 'color.light.accent', value: '#1a5fd0' },
      { key: 'color.dark.appBg', value: '#202830' },
      { key: 'color.light.appBg', value: '#fdf6e3' },
      { key: 'activeLayoutId', value: '2' },
      { key: 'keyboardShortcuts', value: '{"command-palette":"Mod-Alt-p","open-settings":"g o"}' },
      { key: 'eisenhowerPanes', value: JSON.stringify(SEED_PANES) },
      { key: 'eisenhowerSource', value: 'list:2' },
    ],
    statuses: [
      { id: 1, name: 'Assigned', color: '#8a8a8a', sortOrder: 0, icon: 'person' },
      { id: 2, name: 'Follow-up', color: '#e0a030', sortOrder: 1, icon: 'message-bubble' },
    ],
    listDefinitions: [{
      id: 2, name: 'Follow-ups', sortOrder: 1,
      membership: { kind: 'custom', predicate: { ...FULL_PREDICATE, dates: { deadline: { match: 'set' }, followup: { match: 'range', start: null, end: { kind: 'offset', days: 7 }, includeNoDate: true } }, markers: [{ values: ['focus'], not: true }], negate: { personIds: true, statusIds: true, tags: true } } },
      sort: 'followup', grouping: 'followup',
      owner: { layoutId: 2 }, showFilterLine: false, tabBadges: { due: 7, followup: 'overdue' }, ignoreLens: true,
    }, {
      id: 3, name: 'Eisenhower', sortOrder: 2,
      membership: { kind: 'custom', predicate: FULL_PREDICATE },
      sort: 'manual', grouping: 'priority',
      owner: { eisenhower: true },
    }, {
      id: 1, name: 'By person', sortOrder: 0,
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), showCompleted: true, expression: EXPRESSION } },
      sort: 'deadline', sortDirection: 'desc', grouping: 'people',
      runtimeFilter: { field: 'person' },
      owner: { layoutId: 2 },
    }],
    notes: [{ id: 1, content: '# Inbox\n\n- remember', createdAt: at('2026-09-01T09:00:00.000Z'), modifiedAt: at('2026-09-15T08:00:00.000Z') }],
    todoEvents: [
      { id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: '2026-09-02T10:00:00.000Z' },
      { id: 2, todoId: 1, type: 'deadline', fromValue: null, toValue: '2026-10-16T00:00:00.000Z', timestamp: '2026-09-11T09:30:00.000Z' },
      { id: 3, todoId: 1, type: 'status', fromValue: 1, toValue: 2, timestamp: '2026-09-11T09:31:00.000Z' },
      // The history log H3's types (D26).
      { id: 4, todoId: 1, type: 'followup', fromValue: null, toValue: '2026-10-20T00:00:00.000Z', timestamp: '2026-09-11T09:32:00.000Z' },
      { id: 5, todoId: 1, type: 'followedUp', fromValue: '2026-09-01T00:00:00.000Z', toValue: '2026-09-11T09:33:00.000Z', timestamp: '2026-09-11T09:33:00.000Z' },
      { id: 6, todoId: 1, type: 'marker', fromValue: 'important', toValue: 'urgent,important,focus', timestamp: '2026-09-11T09:34:00.000Z' },
      { id: 7, todoId: 1, type: 'person', fromValue: null, toValue: 1, timestamp: '2026-09-11T09:35:00.000Z' },
      { id: 8, todoId: 1, type: 'tag', fromValue: 1, toValue: null, timestamp: '2026-09-11T09:36:00.000Z' },
      { id: 9, todoId: 1, type: 'completed', fromValue: null, toValue: null, timestamp: '2026-09-12T09:00:00.000Z' },
      { id: 10, todoId: 1, type: 'reopened', fromValue: null, toValue: null, timestamp: '2026-09-12T10:00:00.000Z' },
    ],
    statusUpdates: [
      { id: 1, todoId: 1, date: at('2026-09-10T00:00:00.000Z'), text: 'Asked Finance for the numbers', createdAt: at('2026-09-10T15:00:00.000Z') },
      { id: 2, todoId: 1, date: at('2026-09-13T00:00:00.000Z'), text: 'Numbers in; drafting', createdAt: at('2026-09-13T14:25:31.000Z'), followedUp: true },
    ],
    subtasks: [
      { id: 1, todoId: 1, title: 'Collect the numbers', isCompleted: true, sortOrder: 0, createdAt: at('2026-09-10T15:00:00.000Z') },
      { id: 2, todoId: 1, title: 'Draft the charts', isCompleted: false, sortOrder: 1, createdAt: at('2026-09-10T15:01:00.000Z') },
    ],
    layouts: [
      { id: 1, name: 'Empty', sortOrder: 1, ...emptyBody(), createdAt: at('2026-09-01T09:00:00.000Z'), modifiedAt: at('2026-09-01T09:00:00.000Z') },
      {
        id: 2, name: 'Daily', sortOrder: 0,
        createdAt: at('2026-09-02T09:00:00.000Z'), modifiedAt: at('2026-09-14T10:00:00.000Z'), lastUsedAt: at('2026-09-15T08:00:00.000Z'), hue: 'violet',
        // A fixed collapsed row across the top, k3 spanning two rows (one collapsed), an empty cell, a fixed row at the bottom.
        ...(() => {
          const b1 = cell('b1-c', [{ id: 't8', kind: 'notes', config: {} }, { id: 't9', kind: 'lens', config: { listDefinitionId: 1 } }], { activeTabId: 't9' })
          const k1 = cell('k1', [
            { id: 't1', kind: 'lens', config: { listDefinitionId: 1 } },
            { id: 't2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'month', offset: -2 } },
          ], { activeTabId: 't2' })
          const k2 = cell('k2', [{ id: 't3', kind: 'notes', config: {} }, { id: 't4', kind: 'lens', config: { listDefinitionId: 2 } }])
          const k3 = cell('k3', [
            numberTab('t5', 'noFollowup', { breakdown: 'tags', ignoreLens: true, litWhen: 'below', litAt: 4 }),
            { id: 't6', kind: 'lens', config: {} },
            { id: 't11', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [1] }, untouchedDays: 21 } },
            // Item 12: a Review widget by list, its sort and lens switch.
            { id: 't14', kind: 'review', config: { by: 'list' }, viewState: { sort: 'next', ignoreLens: true } },
            // The glance widgets, each with a setting off its default.
            numberTab('g1', 'closedThisWeek'),
            { id: 'g4', kind: 'trend', config: { range: '12w' } },
            { id: 'g5', kind: 'breakdown', config: { name: 'Waiting on', filter: { ...emptyPredicate(), statusIds: [1] }, splitBy: 'people', style: 'donut', show: 'oldest', oldestBy: 'lastFollowup', showNone: false, checkins: true, badges: { due: 'overdue', followup: 7 } }, viewState: { sorts: { people: { by: 'due', reversed: true } } } },
            { id: 'g6', kind: 'breakdown', config: { name: 'Status', filter: emptyPredicate(), splitBy: 'status', style: 'stacked', show: 'count', showNone: true, badges: 'off' } },
            { id: 'g7', kind: 'pivot', config: { name: 'Who × what', filter: { ...emptyPredicate(), statusIds: [1] }, rows: 'tags', cols: 'priority' } },
            { id: 'g13', kind: 'pulse', config: { tagIds: [1] } },
          ])
          const k4 = cell('k4')
          const k5 = cell('k5', [{ id: 't12', kind: 'notes', config: {} }])
          const b2c = cell('b2-c', [{ id: 't10', kind: 'calendar', config: { dateTypes: { due: false, followup: true } }, viewState: { view: 'week' } }])
          const b2d = cell('b2-d', [{ id: 't13', kind: 'notes', config: {} }])
          return grid([
            [b1, b1, b1],
            [k1, k1, k3],
            [k2, k2, k3],
            [k4, k5, k5],
            [b2c, b2d, b2d],
          ], {
            cols: [300, 300, 400],
            rows: [{ px: 112, collapsed: true }, 2000, { weight: 1000, collapsed: true }, 500, { px: 150 }],
          })
        })(),
      },
    ],
    listOrders: [
      { id: 1, listDefinitionId: 2, todoId: 2, rank: 1 },
      { id: 2, listDefinitionId: 2, todoId: 1, rank: 1.5 },
    ],
  }
}

/**
 * The removed Eisenhower's panes as a v78 database holds them: carried as
 * stored (schema v79 deletes the row), like its list (`owner: { eisenhower: true }`).
 */
const SEED_PANES = {
  do: { name: 'Now', filter: { showCompleted: false, personIds: [1], statusIds: null, searchText: 'call', dates: { deadline: { match: 'set' } }, markers: [{ values: ['focus'] }, { values: ['urgent'], not: true }], tags: [2], negate: { tags: true } } },
  delegate: { filter: { ...emptyPredicate(), expression: { kind: 'and', items: [{ kind: 'not', item: { kind: 'status', id: 3 } }, { kind: 'priority', value: 'urgent' }, { kind: 'not', item: { kind: 'priority', value: 'important' } }] } } },
  drop: { name: 'Someday' },
}

function tableByName(name: string): Table {
  const t = ALL_DATA_TABLES.find((x) => x.name === name)
  if (!t) throw new Error(`no data table ${name}`)
  return t as unknown as Table
}

function rowId(row: Record<string, unknown>): string {
  return String(row.id ?? row.key)
}

function sortRows<T>(rows: T[]): T[] {
  return [...rows].sort((a, b) => rowId(a as Record<string, unknown>).localeCompare(rowId(b as Record<string, unknown>), 'en', { numeric: true }))
}

/** Every path where the seed holds a `Date` must hold a valid `Date` after import. */
function expectDatesAt(expected: unknown, actual: unknown, path: string) {
  if (expected instanceof Date) {
    expect(actual instanceof Date, `${path} must be a Date (got ${typeof actual})`).toBe(true)
    return
  }
  if (Array.isArray(expected)) {
    expected.forEach((e, i) => expectDatesAt(e, (actual as unknown[] | undefined)?.[i], `${path}[${i}]`))
    return
  }
  if (expected && typeof expected === 'object') {
    for (const [k, v] of Object.entries(expected)) {
      expectDatesAt(v, (actual as Record<string, unknown> | undefined)?.[k], `${path}.${k}`)
    }
  }
}

async function writeSeed(seed: Seed) {
  await db.transaction('rw', [...ALL_DATA_TABLES], async () => {
    for (const t of ALL_DATA_TABLES) await t.clear()
    for (const key of DATA_TABLE_NAMES) {
      await tableByName(key).bulkAdd(seed[key])
    }
  })
}

beforeEach(async () => {
  await resetDb()
})

describe('export → JSON → import round-trip', () => {
  it('the seed covers every data table and every field each picker carries', () => {
    const seed = buildSeed()
    expect([...DATA_TABLE_NAMES].sort()).toEqual(ALL_DATA_TABLES.map((t) => t.name).sort())
    for (const key of DATA_TABLE_NAMES) {
      const rows = seed[key] as unknown as Array<Record<string, unknown>>
      expect(rows.length, `seed.${key} is populated`).toBeGreaterThan(0)
      const declared = Object.keys(IMPORT_TABLES[key].pick(rows[0]!))
      const covered = new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))
      const missing = declared.filter((f) => !covered.has(f))
      expect(missing, `seed.${key} must populate every model field — add these to buildSeed()`).toEqual([])
    }
    // Every setting this build knows.
    const settingKeys = new Set(seed.settings.map((s) => s.key))
    expect(ALL_SETTING_KEYS.filter((k) => !settingKeys.has(k)), 'settings missing from buildSeed()').toEqual([])
    // Every event type the log writes (all but the history-only `scheduled`).
    expect(new Set(seed.todoEvents.map((e) => e.type))).toEqual(new Set(TODO_EVENT_TYPES.filter((t) => t !== 'scheduled')))
    // Nested shapes the table-level check can't see.
    expect(seed.todos.some((t) => t.recurrenceRule?.originalDayOfMonth !== undefined)).toBe(true)
    expect(seed.listDefinitions.some((d) => d.runtimeFilter !== undefined)).toBe(true)
    // Both kinds of owner: a layout's list and the retired Eisenhower's (carried as stored).
    expect(seed.listDefinitions.some((d) => d.owner !== undefined && 'layoutId' in d.owner)).toBe(true)
    expect(seed.listDefinitions.some((d) => d.owner !== undefined && 'eisenhower' in d.owner)).toBe(true)
    // A Priority filter's forms: "is" with several values, and "is not".
    const markers = seed.listDefinitions.flatMap((d) => (d.membership.kind === 'custom' ? d.membership.predicate.markers ?? [] : []))
    expect(markers.some((c) => c.values.length > 1)).toBe(true)
    expect(markers.some((c) => c.not === true)).toBe(true)
    // Every "is not" switch.
    const negations = seed.listDefinitions.flatMap((d) => d.membership.kind === 'custom' ? Object.keys(d.membership.predicate.negate ?? {}) : [])
    expect(new Set(negations)).toEqual(new Set(NEGATABLE_FIELDS))
    // Expressions: on a list, with every kind of atom and a `not`; in a lens and the check-in filter.
    const expressions = seed.listDefinitions.flatMap((d) => (d.membership.kind === 'custom' && d.membership.predicate.expression ? [d.membership.predicate.expression] : []))
    expect(new Set(expressions.flatMap((e) => expressionAtoms(e).map((a) => a.kind)))).toEqual(new Set(['person', 'tag', 'status', 'priority', 'text', 'date']))
    expect(JSON.stringify(expressions)).toContain('"kind":"not"')
    for (const key of ['lenses', 'checkinTaskFilter']) {
      expect(seed.settings.find((r) => r.key === key)?.value, `${key} holds an expression`).toContain('"expression"')
    }
    // Every date type and every kind of date clause.
    const clauses = seed.listDefinitions.flatMap((d) => d.membership.kind === 'custom' ? Object.entries(d.membership.predicate.dates) : [])
    expect(new Set(clauses.map(([field]) => field))).toEqual(new Set(DATE_FIELD_VALUES))
    expect(new Set(clauses.map(([, m]) => m.match))).toEqual(new Set(['range', 'set', 'unset']))
    expect(clauses.some(([, m]) => m.match === 'range' && m.includeNoDate === true)).toBe(true)
    expect(clauses.some(([, m]) => m.match === 'range' && m.not === true)).toBe(true)
    const rows = seed.layouts.flatMap((l) => l.grid.rows)
    const cells = seed.layouts.flatMap((l) => l.cells)
    const tabs = cells.flatMap((c) => c.tabs)
    expect(cells.some((c) => c.activeTabId !== undefined)).toBe(true)
    expect(rows.some((r) => r.collapsed === true && r.px == null)).toBe(true)
    expect(rows.some((r) => r.collapsed === true && r.px != null)).toBe(true)
    expect(rows.some((r) => r.weight !== undefined && r.weight !== 1000)).toBe(true)
    expect(cells.some((c) => c.tabs.length === 0)).toBe(true)
    expect(cells.some((c) => c.area.rowSpan > 1)).toBe(true)
    expect(cells.some((c) => c.area.colSpan > 1)).toBe(true)
    expect(new Set(tabs.map((t) => t.kind))).toEqual(new Set(WIDGET_KINDS))
    expect(tabs.some((t) => t.kind === 'lens' && t.config.listDefinitionId !== undefined)).toBe(true)
    expect(tabs.some((t) => t.kind === 'calendar' && t.viewState?.view !== undefined && t.viewState.offset !== undefined)).toBe(true)
    expect(tabs.some((t) => t.kind === 'number' && t.config.breakdown !== undefined)).toBe(true)
  })

  it('restores every table deep-equal to the seed, with real Dates', async () => {
    const seed = buildSeed()
    await writeSeed(seed)

    const json = JSON.stringify(await buildExportData())
    const prepared = prepareImportText(json)
    if (!prepared.ok) throw new Error(`round-trip import failed: ${prepared.error}`)
    expect(prepared.sourceVersion).toBe(CURRENT_DB_VERSION)
    expect(prepared.upgraded).toBe(false)
    expect(prepared.warnings).toEqual([])

    await resetDb()
    await restoreFromImportData(prepared.data)

    for (const key of DATA_TABLE_NAMES) {
      const expected = sortRows(seed[key] as unknown as Array<Record<string, unknown>>)
      const actual = sortRows((await tableByName(key).toArray()) as Array<Record<string, unknown>>)
      expect(actual.map(rowId), `${key}: row ids`).toEqual(expected.map(rowId))
      expected.forEach((exp, i) => {
        const act = actual[i]!
        const where = `${key}[${rowId(exp)}]`
        expect(Object.keys(act).sort(), `${where}: fields`).toEqual(Object.keys(exp).sort())
        for (const field of Object.keys(exp)) {
          expect(act[field], `${where}.${field}`).toEqual(exp[field])
          expectDatesAt(exp[field], act[field], `${where}.${field}`)
        }
      })
    }
  })
})

describe('export → import accepts every text length the app can store', () => {
  it('a task note and the workspace note far longer than a typical paste', async () => {
    // Notes have no length limit in the editor (and a check-in reply can
    // replace a note with up to its 2 MB cap), so an export holding them must
    // import: a cap here made every backup and the sync file unloadable.
    const long = 'x'.repeat(3_000_000)
    await db.todos.add(makeTodo({ id: 1, notes: long }))
    await db.notes.add({ id: 1, content: long, createdAt: new Date(), modifiedAt: new Date() })
    const prepared = prepareImportText(JSON.stringify(await buildExportData()))
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.todos?.[0]?.notes).toHaveLength(long.length)
    expect(prepared.data.notes?.[0]?.content).toHaveLength(long.length)
  })

  it('person, tag, status and list names of 1,000 characters (export → restore)', async () => {
    // The editors have no length limit and `@name` / `#tag` create names
    // from Quick Add and notes, so long names must survive a restore.
    const seed = buildSeed()
    const long = (prefix: string) => `${prefix} ${'n'.repeat(1000 - prefix.length - 1)}`
    seed.people[0]!.name = long('person')
    seed.tags[0]!.name = long('tag')
    seed.statuses[0]!.name = long('status')
    seed.listDefinitions[0]!.name = long('list')
    await writeSeed(seed)

    const prepared = prepareImportText(JSON.stringify(await buildExportData()))
    if (!prepared.ok) throw new Error(prepared.error)
    await resetDb()
    await restoreFromImportData(prepared.data)

    expect((await db.people.get(1))?.name).toBe(long('person'))
    expect((await db.tags.get(1))?.name).toBe(long('tag'))
    expect((await db.statuses.get(1))?.name).toBe(long('status'))
    expect((await db.listDefinitions.get(2))?.name).toBe(long('list'))
    for (const name of [long('person'), long('tag'), long('status'), long('list')]) expect(name).toHaveLength(1000)
  })

  it('a task title of 1,000 characters (export → restore)', async () => {
    // Converting a note line can make a title over 500 characters.
    const seed = buildSeed()
    const title = `title ${'t'.repeat(994)}`
    seed.todos[0]!.title = title
    await writeSeed(seed)

    const prepared = prepareImportText(JSON.stringify(await buildExportData()))
    if (!prepared.ok) throw new Error(prepared.error)
    await resetDb()
    await restoreFromImportData(prepared.data)

    expect(title).toHaveLength(1000)
    expect((await db.todos.get(1))?.title).toBe(title)
  })
})
