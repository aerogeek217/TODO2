import { describe, it, expect, beforeEach } from 'vitest'
import type { Table } from 'dexie'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { IMPORT_ROW_PICKERS, KNOWN_TABLE_KEYS, type ImportData } from '../../data/import-validation'
import { prepareImportText } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { buildExportData } from '../../services/export-import'
import type { TodoPredicate } from '../../models/filter-predicate'
import { resetDb } from '../helpers'

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
  showHiddenStatuses: true,
  personIds: [1, 0],
  personFilterMode: 'direct-only',
  orgIds: [1],
  orgFilterMode: 'direct-only',
  projectIds: [1, 0],
  statusIds: [1, 2],
  searchText: 'invoice',
  dateField: 'deadline',
  dateRangeStart: { kind: 'fixed', iso: '2026-10-01T00:00:00.000Z' },
  dateRangeEnd: { kind: 'offset', days: 30 },
  dateRangeIncludeNoDate: true,
  hasScheduled: false,
  hasDeadline: true,
  tags: [1],
}

const RAILS = JSON.stringify({
  left: { orientation: 'vertical', slots: [{ id: 's1', activeTabId: 't1', tabs: [{ id: 't1', type: 'lens', listDefinitionId: 1 }] }] },
  right: null, top: null, bottom: null,
})

function buildSeed(): Seed {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: at('2026-09-01T09:00:00.000Z') }],
    projects: [
      {
        id: 1, name: 'Work', canvasId: 1, positionX: 120, positionY: 80, width: 360, isCollapsed: false,
        color: '#4f8cff', sortOrder: 0, createdAt: at('2026-09-01T09:05:00.000Z'),
        groupBy: 'status', groupOrder: ['status:2', 'status:1'],
      },
      {
        id: 2, name: 'Home', canvasId: 1, positionX: 600, positionY: 80, isCollapsed: true,
        sortOrder: 1, createdAt: at('2026-09-01T09:06:00.000Z'), groupBy: null,
      },
    ],
    todos: [
      {
        id: 1, uid: '0b6f3c2e-1d4a-4c8e-9f21-7a5b3c9d1e01', title: 'Send quarterly report', notes: 'Include **charts**', progress: 'draft done',
        isCompleted: false,
        scheduledDate: { kind: 'date', value: at('2026-10-12T00:00:00.000Z') },
        dueDate: at('2026-10-16T00:00:00.000Z'),
        recurrenceRule: { type: 'monthly', originalDayOfMonth: 31 },
        createdAt: at('2026-09-02T10:00:00.000Z'), modifiedAt: at('2026-09-11T09:30:00.000Z'),
        projectId: 1, canvasId: 1, statusId: 2, sortOrder: 0,
      },
      {
        id: 2, uid: '0b6f3c2e-1d4a-4c8e-9f21-7a5b3c9d1e02', title: 'Book dentist', isCompleted: true,
        completedAt: at('2026-09-10T09:30:00.000Z'),
        scheduledDate: { kind: 'fuzzy', token: 'next-week', setAt: at('2026-09-10T09:30:00.000Z') },
        createdAt: at('2026-09-03T11:00:00.000Z'), modifiedAt: at('2026-09-10T09:30:00.000Z'),
        sortOrder: 1,
      },
    ],
    people: [{ id: 1, name: 'Ann Lee', initials: 'AL' }],
    tags: [{ id: 1, name: 'urgent', color: '#ff0000' }],
    listInsets: [{
      id: 1, listDefinitionId: 1, canvasId: 1, x: 10, y: 20, width: 320, height: 300,
      isCollapsed: true, runtimeFilterValue: [1, 2],
    }],
    todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
    todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
    todoOrgs: [{ id: 1, todoId: 2, orgId: 1 }],
    personOrgs: [{ id: 1, personId: 1, orgId: 1 }],
    settings: [
      { key: 'seededAssignedStatusId', value: '1' },
      { key: 'seededFollowupStatusId', value: '2' },
      { key: 'weekStartsOn', value: '1' },
      { key: 'themeMode', value: 'dark' },
      { key: 'canvasRails', value: RAILS },
      { key: 'color.dark.accent', value: '#4f8cff' },
    ],
    orgs: [{ id: 1, name: 'Acme', initials: 'AC', color: '#e05050' }],
    taskboards: [{
      id: 1, entries: [{ todoId: 2, sortOrder: 0 }, { todoId: 1, sortOrder: 1 }],
      createdAt: at('2026-09-01T09:00:00.000Z'), updatedAt: at('2026-09-15T08:00:00.000Z'),
    }],
    floatingTaskboards: [{ id: 1, canvasId: 1, x: 1, y: 2, width: 300, height: 400, collapsed: true }],
    statuses: [
      { id: 1, name: 'Assigned', color: '#8a8a8a', sortOrder: 0, icon: 'person', hideByDefault: true },
      { id: 2, name: 'Follow-up', color: '#e0a030', sortOrder: 1, icon: 'message-bubble', hideByDefault: false },
    ],
    listDefinitions: [{
      id: 1, name: 'By person', sortOrder: 0,
      membership: { kind: 'custom', predicate: FULL_PREDICATE },
      sort: 'deadline', grouping: 'people', pinnedToDashboard: false, favorited: true,
      maxTasks: 25, limitMode: 'scroll', runtimeFilter: { field: 'person', label: 'Who' },
    }],
    notes: [{ id: 1, content: '# Inbox\n\n- remember', createdAt: at('2026-09-01T09:00:00.000Z'), modifiedAt: at('2026-09-15T08:00:00.000Z') }],
    floatingCalendars: [{ id: 1, canvasId: 1, x: 5, y: 6, width: 400, height: 300, orientation: 'horizontal', weekOffset: -1 }],
    floatingNotes: [{ id: 1, canvasId: 1, x: 7, y: 8, width: 240, height: 200 }],
    floatingStatus: [{ id: 1, canvasId: 1, x: 11, y: 12, width: 260, height: 180, collapsed: true }],
    todoEvents: [
      { id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: '2026-09-02T10:00:00.000Z' },
      { id: 2, todoId: 1, type: 'deadline', fromValue: null, toValue: '2026-10-16T00:00:00.000Z', timestamp: '2026-09-11T09:30:00.000Z' },
      { id: 3, todoId: 1, type: 'status', fromValue: 1, toValue: 2, timestamp: '2026-09-11T09:31:00.000Z' },
    ],
  }
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
    for (const key of KNOWN_TABLE_KEYS) {
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
    expect([...KNOWN_TABLE_KEYS].sort()).toEqual(ALL_DATA_TABLES.map((t) => t.name).sort())
    for (const key of KNOWN_TABLE_KEYS) {
      const rows = seed[key] as Array<Record<string, unknown>>
      expect(rows.length, `seed.${key} is populated`).toBeGreaterThan(0)
      const declared = Object.keys(IMPORT_ROW_PICKERS[key](rows[0]!))
      const covered = new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))
      const missing = declared.filter((f) => !covered.has(f))
      expect(missing, `seed.${key} must populate every model field — add these to buildSeed()`).toEqual([])
    }
    // Nested shapes the table-level check can't see.
    const kinds = seed.todos.map((t) => t.scheduledDate?.kind)
    expect(kinds).toContain('date')
    expect(kinds).toContain('fuzzy')
    expect(seed.todos.some((t) => t.recurrenceRule?.originalDayOfMonth !== undefined)).toBe(true)
    expect(seed.listDefinitions.some((d) => d.runtimeFilter?.label !== undefined)).toBe(true)
    expect(seed.taskboards.some((b) => b.entries.length > 0)).toBe(true)
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

    for (const key of KNOWN_TABLE_KEYS) {
      const expected = sortRows(seed[key] as Array<Record<string, unknown>>)
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
