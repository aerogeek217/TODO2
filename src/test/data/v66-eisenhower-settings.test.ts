import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV66 } from '../../data/upgrades/v66-eisenhower-settings'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { buildExportData } from '../../data/export-data'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { useSettingsStore } from '../../stores/settings-store'
import { resetDb, v65StoreSpecs } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')

const filter = (extra: Record<string, unknown>) => ({ showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, ...extra })

/** Hand off = Urgent, not Important, not Delegated (status 3). */
const HAND_OFF = { delegate: { name: 'Hand off', filter: filter({ markers: { urgent: true, important: false }, statusIds: [3], negate: { statusIds: true } }) } }
const SOMEDAY = { drop: { name: 'Someday' } }

const eis = (id: string, config: Record<string, unknown> = {}, viewState?: Record<string, unknown>): DataRow =>
  ({ id, kind: 'eisenhower', config, ...(viewState ? { viewState } : {}) })
const notes = (id: string): DataRow => ({ id, kind: 'notes', config: {} })
const cells = (...tabs: DataRow[][]) => [{ id: 'c1', weight: 1, cells: tabs.map((t, i) => ({ id: `k${i}`, weight: 1, tabs: t })) }]
const layout = (id: number | undefined, columns: unknown, extra: Record<string, unknown> = {}): DataRow =>
  ({ ...(id !== undefined ? { id } : {}), name: `L${id ?? '?'}`, createdAt: AT, modifiedAt: AT, columns, ...extra })

/** Two layouts with customized Eisenhower tabs — the second row has the lower id, so it is read first. */
const v65Rows = (): DataSet => ({
  settings: [{ key: 'themeMode', value: 'dark' }],
  layouts: [
    layout(2, cells([eis('a', { panes: SOMEDAY, listDefinitionId: 7 })])),
    layout(1, cells([notes('n'), eis('b')], [eis('c', { panes: HAND_OFF }, { collapsed: ['drop'] })])),
  ],
})

describe('upgradeV66 (pure)', () => {
  it('is the v66 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(66)
    expect(SCHEMA_UPGRADES.get(66)).toBe(upgradeV66)
  })

  it('moves the first customized tab’s panes and the first list into the settings (layouts by id), and strips every Eisenhower tab', () => {
    const out = upgradeV66(v65Rows())
    expect(out.settings).toEqual([
      { key: 'themeMode', value: 'dark' },
      // Layout 1 is read first: its tab c's panes; the first list is layout 2's.
      { key: 'eisenhowerPanes', value: JSON.stringify(HAND_OFF) },
      { key: 'eisenhowerSource', value: 'list:7' },
    ])
    expect(out.layouts).toEqual([
      layout(2, cells([eis('a')])),
      layout(1, cells([notes('n'), eis('b')], [eis('c', {}, { collapsed: ['drop'] })])),
    ])
  })

  it('reads a layout’s top band first, then its cells, then its bottom band', () => {
    const row = layout(1, cells([eis('cell', { panes: HAND_OFF })]), {
      top: { id: 'top', height: 120, tabs: [eis('t', { panes: SOMEDAY })] },
      bottom: { id: 'bot', height: 120, tabs: [eis('b', { listDefinitionId: 9 })] },
    })
    const out = upgradeV66({ settings: [], layouts: [row] })
    expect(out.settings).toEqual([{ key: 'eisenhowerPanes', value: JSON.stringify(SOMEDAY) }, { key: 'eisenhowerSource', value: 'list:9' }])
    expect(out.layouts![0]).toEqual(layout(1, cells([eis('cell')]), {
      top: { id: 'top', height: 120, tabs: [eis('t')] },
      bottom: { id: 'bot', height: 120, tabs: [eis('b')] },
    }))
  })

  it('a setting already there wins; empty panes and an unusable list id give nothing, but are stripped', () => {
    const data: DataSet = {
      settings: [{ key: 'eisenhowerPanes', value: '{}' }],
      layouts: [layout(1, cells([eis('a', { panes: {}, listDefinitionId: 0 }), eis('b', { panes: HAND_OFF, listDefinitionId: 'x' }), eis('c', { listDefinitionId: 1.5 })]))],
    }
    const out = upgradeV66(data)
    expect(out.settings).toBe(data.settings)
    expect(out.layouts).toEqual([layout(1, cells([eis('a'), eis('b'), eis('c')]))])
  })

  it('without a settings table (a kept layout draft, a task archive) only strips the tabs', () => {
    const out = upgradeV66({ layouts: [{ columns: cells([eis('a', { panes: HAND_OFF, listDefinitionId: 7 })]) }] })
    expect(out).toEqual({ layouts: [{ columns: cells([eis('a')]) }] })
    expect('settings' in out).toBe(false)
  })

  it('returns its input when nothing changes: v66 data, no layouts, rows it can’t walk', () => {
    const v66: DataSet = { settings: [], layouts: [layout(1, cells([eis('a'), notes('n')]))] }
    expect(upgradeV66(v66)).toBe(v66)
    const twice = upgradeV66(v65Rows())
    expect(upgradeV66(twice)).toBe(twice)
    const none: DataSet = { todos: [] }
    expect(upgradeV66(none)).toBe(none)
    const odd: DataSet = { settings: [], layouts: [null as unknown as DataRow, { columns: 'x' }, layout(1, [{ id: 'c', cells: [{ tabs: [eis('a', null as never), 'z'] }] }])] }
    expect(upgradeV66(odd)).toBe(odd)
  })

  it('the first customized panes that can’t be written as JSON (a cycle, too deep, a BigInt) give no panes setting; every tab is still stripped', () => {
    const cyclic: Record<string, unknown> = { drop: { name: 'Someday' } }
    cyclic.self = cyclic
    let deep: Record<string, unknown> = {}
    const deepPanes = { drop: { name: 'Deep', filter: deep } }
    for (let i = 0; i < 200_000; i++) {
      const next: Record<string, unknown> = {}
      deep.x = next
      deep = next
    }
    for (const panes of [cyclic, deepPanes, { drop: { name: 'Big', extra: 1n } }]) {
      const out = upgradeV66({
        settings: [],
        layouts: [layout(1, cells([eis('a', { panes, listDefinitionId: 7 }), eis('b', { panes: SOMEDAY })]))],
      })
      expect(out.settings).toEqual([{ key: 'eisenhowerSource', value: 'list:7' }])
      expect(out.layouts).toEqual([layout(1, cells([eis('a'), eis('b')]))])
    }
  })

  it('never changes its input', () => {
    const data = v65Rows()
    const before = JSON.stringify(data)
    upgradeV66(data)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('v66 files', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('a v65 file with two customized Eisenhower tabs imports with the settings made, the tabs without them', () => {
    const prepared = prepareImport(JSON.parse(JSON.stringify({ [SCHEMA_VERSION_KEY]: 65, todos: [], ...v65Rows() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared).toMatchObject({ sourceVersion: 65, upgraded: true, warnings: [] })
    expect(prepared.data.settings).toEqual([
      { key: 'themeMode', value: 'dark' },
      { key: 'eisenhowerPanes', value: JSON.stringify(HAND_OFF) },
      { key: 'eisenhowerSource', value: 'list:7' },
    ])
    const tabs = prepared.data.layouts.flatMap((l) => l.columns.flatMap((c) => c.cells.flatMap((k) => k.tabs)))
    expect(tabs.filter((t) => t.kind === 'eisenhower').map((t) => t.config)).toEqual([{}, {}, {}])
  })

  it('a v65 tab whose panes hold parts this build can’t read still imports: those parts reset, with a warning', () => {
    const quirky = { do: 'Now', schedule: { name: 7 }, drop: { name: 'Someday', filter: { searchText: '' } }, delegate: HAND_OFF.delegate }
    const file = {
      [SCHEMA_VERSION_KEY]: 65, todos: [], settings: [],
      layouts: [layout(1, cells([eis('a', { panes: quirky })]))],
    }
    const prepared = prepareImport(JSON.parse(JSON.stringify(file)) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual(['Fixed settings: Eisenhower panes (3 Eisenhower panes reset)'])
    expect(prepared.data.settings).toEqual([{ key: 'eisenhowerPanes', value: JSON.stringify({ delegate: HAND_OFF.delegate, drop: { name: 'Someday' } }) }])
  })

  it('an export holding the settings is stamped v66 or later, so a v65 build refuses it as too new', async () => {
    await db.settings.put({ key: 'eisenhowerPanes', value: JSON.stringify(HAND_OFF) })
    const exported = await buildExportData()
    expect(exported[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exported[SCHEMA_VERSION_KEY]).toBeGreaterThan(65)
  })
})

/** The live-DB path: a v65 database opened by the current build. */
describe('v66 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('opens a v65 database at the current version: the settings made, every Eisenhower tab stripped, the rest as it was', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v65 = new Dexie(db.name)
    v65.version(65).stores(v65StoreSpecs())
    await v65.open()
    for (const [table, rows] of Object.entries(v65Rows())) await v65.table(table).bulkAdd(rows)
    v65.close()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await db.settings.toArray()).toEqual(expect.arrayContaining([
      { key: 'themeMode', value: 'dark' },
      { key: 'eisenhowerPanes', value: JSON.stringify(HAND_OFF) },
      { key: 'eisenhowerSource', value: 'list:7' },
    ]))
    expect(await db.settings.count()).toBe(3)
    expect(await db.layouts.orderBy('id').toArray()).toEqual([
      layout(1, cells([notes('n'), eis('b')], [eis('c', {}, { collapsed: ['drop'] })])),
      layout(2, cells([eis('a')])),
    ])
    // The settings store reads them.
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState()).toMatchObject({ eisenhowerPanes: HAND_OFF, eisenhowerListId: 7 })
  })

  it('opens a v65 database whose first customized panes can’t be written as JSON (a cycle IndexedDB kept): no panes setting, tabs stripped', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v65 = new Dexie(db.name)
    v65.version(65).stores(v65StoreSpecs())
    await v65.open()
    const cyclic: Record<string, unknown> = { drop: { name: 'Someday' } }
    cyclic.self = cyclic
    await v65.table('layouts').add(layout(1, cells([eis('a', { panes: cyclic })])))
    v65.close()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
    expect(await db.layouts.toArray()).toEqual([layout(1, cells([eis('a')]))])
  })
})
