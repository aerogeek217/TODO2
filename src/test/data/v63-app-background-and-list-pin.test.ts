import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV63 } from '../../data/upgrades/v63-app-background-and-list-pin'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { validateImportData } from '../../data/import-validation'
import { backupRepository } from '../../data/backup-repository'
import { restoreBackup, restoreFromImport } from '../../services/replace-data'
import { runAppendImport } from '../../services/append-import'
import { useSettingsStore } from '../../stores/settings-store'
import { makeTodo, resetDb, v62StoreSpecs } from '../helpers'

const PREDICATE = {
  showCompleted: false, personIds: null, statusIds: null, searchText: '', dateField: 'deadline',
  dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: null,
}

const list = (id: number, extra: DataRow = {}): DataRow => ({
  id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: PREDICATE }, ...extra,
})

/** v62 data with the app background overridden in both themes and pinned / unpinned lists. */
function v62DataSet(): DataSet {
  return {
    listDefinitions: [
      list(1, { pinnedToDashboard: true, maxTasks: 10 }),
      list(2, { pinnedToDashboard: false }),
      list(3),
    ],
    settings: [
      { key: 'themeMode', value: 'dark' },
      { key: 'color.dark.accent', value: '#4f8cff' },
      { key: 'color.dark.canvasBg', value: '#203040' },
      { key: 'color.light.canvasBg', value: '#fdf6e3' },
      { key: 'weekStartsOn', value: '1' },
    ],
  }
}

/** The colour rows of the database, by key. */
async function storedColours(): Promise<Record<string, string>> {
  return Object.fromEntries((await db.settings.toArray()).filter((s) => s.key.startsWith('color.')).map((s) => [s.key, s.value]))
}

const UPGRADED_COLOURS = {
  'color.dark.accent': '#4f8cff',
  'color.dark.appBg': '#203040',
  'color.light.appBg': '#fdf6e3',
}

describe('upgradeV63 (pure)', () => {
  it('is the v63 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(63)
    expect(SCHEMA_UPGRADES.get(63)).toBe(upgradeV63)
  })

  it('drops pinnedToDashboard from every list and keeps every other field', () => {
    const out = upgradeV63(v62DataSet())
    expect(out.listDefinitions).toEqual([list(1, { maxTasks: 10 }), list(2), list(3)])
    // A list that never had the field is the same object.
    const input = v62DataSet()
    expect(upgradeV63(input).listDefinitions![2]).toBe(input.listDefinitions![2])
  })

  it('renames the canvasBg colour of each theme to appBg, value and place kept', () => {
    const out = upgradeV63(v62DataSet())
    expect(out.settings).toEqual([
      { key: 'themeMode', value: 'dark' },
      { key: 'color.dark.accent', value: '#4f8cff' },
      { key: 'color.dark.appBg', value: '#203040' },
      { key: 'color.light.appBg', value: '#fdf6e3' },
      { key: 'weekStartsOn', value: '1' },
    ])
  })

  it('keeps an appBg row already there and drops the old one for that theme only', () => {
    const out = upgradeV63({
      settings: [
        { key: 'color.dark.canvasBg', value: '#111111' },
        { key: 'color.dark.appBg', value: '#222222' },
        { key: 'color.light.canvasBg', value: '#eeeeee' },
      ],
    })
    expect(out.settings).toEqual([
      { key: 'color.dark.appBg', value: '#222222' },
      { key: 'color.light.appBg', value: '#eeeeee' },
    ])
  })

  it('the result, upgraded to the current version, passes import validation with no warning', () => {
    const out = upgradeDataSet(upgradeV63(v62DataSet()), 63, CURRENT_DB_VERSION)
    const result = validateImportData({ todos: [], ...out })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.warnings).toEqual([])
  })

  it('is idempotent and tolerates missing tables and malformed rows', () => {
    const once = upgradeV63(v62DataSet())
    expect(upgradeV63(once)).toBe(once)
    const archive: DataSet = { todos: [{ id: 1 }], todoPeople: [] }
    expect(upgradeV63(archive)).toBe(archive)
    const junk: DataSet = {
      listDefinitions: [null as never, 'x' as never, { id: 1, name: 'No pin' }],
      settings: [null as never, { key: 7, value: '#fff' }, { value: '#fff' }],
    }
    expect(upgradeV63(junk)).toBe(junk)
  })

  it('does not mutate its input', () => {
    const input = v62DataSet()
    const copy = JSON.parse(JSON.stringify(input)) as DataSet
    upgradeV63(input)
    expect(input).toEqual(copy)
  })
})

describe('a v62 file with colour overrides imports into the current build', () => {
  const v62File = () => JSON.stringify({ __schemaVersion: 62, todos: [makeTodo({ id: 1, title: 'Kept' })], ...v62DataSet() })

  beforeEach(async () => {
    await resetDb()
  })

  it('prepareImport upgrades it: lists without the pin, colours under the new key', () => {
    const prepared = prepareImportText(v62File())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.sourceVersion).toBe(62)
    expect(prepared.upgraded).toBe(true)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.listDefinitions.some((d) => 'pinnedToDashboard' in d)).toBe(false)
    expect(Object.fromEntries(prepared.data.settings.filter((s) => s.key.startsWith('color.')).map((s) => [s.key, s.value])))
      .toEqual(UPGRADED_COLOURS)
  })

  it('Settings › Import JSON and Settings › Backups restore it with the colours', async () => {
    const prepared = prepareImportText(v62File())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(await restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    expect(await storedColours()).toEqual(UPGRADED_COLOURS)

    await db.settings.clear()
    const id = await backupRepository.createSnapshotFromJson(v62File(), 'manual')
    expect(await restoreBackup(id)).toMatchObject({ status: 'done' })
    expect(await storedColours()).toEqual(UPGRADED_COLOURS)
  })

  it('a v62 task archive (no lists, no settings) appends unchanged', async () => {
    const archive = JSON.stringify({ __schemaVersion: 62, kind: 'task-archive', todos: [makeTodo({ id: 1, uid: 'archived-1', title: 'Archived' })] })
    const prepared = prepareImportText(archive, { purpose: 'append' })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.kind).toBe('task-archive')
    expect(prepared.data.settings).toEqual([])
    expect(await runAppendImport(prepared.data, new Map())).toMatchObject({ status: 'done' })
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual(['Archived'])
  })

  it('an old canvasBg row in a file already at v63 is dropped with a warning, not a failure', () => {
    const prepared = prepareImport({
      __schemaVersion: 63, todos: [],
      settings: [{ key: 'color.dark.canvasBg', value: '#203040' }, { key: 'color.dark.appBg', value: '#405060' }],
    })
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.settings).toEqual([{ key: 'color.dark.appBg', value: '#405060' }])
    expect(prepared.warnings.join('\n')).toContain('color.dark.canvasBg')
  })
})

/** The live-DB path: a v62 database with colour overrides opened by the current build. */
describe('v63 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
    document.documentElement.removeAttribute('style')
  })

  async function openV62Database(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v62 = new Dexie(db.name)
    v62.version(62).stores(v62StoreSpecs())
    await v62.open()
    for (const [table, rows] of Object.entries(v62DataSet())) await v62.table(table).bulkAdd(rows)
    v62.close()
    await db.open()
  }

  it('renames the stored colours and drops the pin, matching the import path', async () => {
    await openV62Database()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await storedColours()).toEqual(UPGRADED_COLOURS)
    const lists = await db.listDefinitions.orderBy('id').toArray()
    expect(lists.some((d) => 'pinnedToDashboard' in d)).toBe(false)

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 62, todos: [], ...v62DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.listDefinitions).toEqual(lists)
    // The table is read in key order.
    const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key)
    expect([...prepared.data.settings].sort(byKey)).toEqual((await db.settings.toArray()).sort(byKey))
  })

  it('the upgraded colour still applies: the app background of the theme in use, in both themes', async () => {
    await openV62Database()
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.appBg).toBe('#203040')
    expect(useSettingsStore.getState().colors.light.appBg).toBe('#fdf6e3')
    expect(document.documentElement.style.getPropertyValue('--color-app-bg')).toBe('#203040')
    await useSettingsStore.getState().setThemeMode('light')
    expect(document.documentElement.style.getPropertyValue('--color-app-bg')).toBe('#fdf6e3')
    // Accent was customised in dark only: light falls back to the stylesheet.
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
  })
})
