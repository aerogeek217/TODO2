import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV52, stripRemovedKindsFromRails } from '../../data/upgrades/v52-drop-date-stat-widgets'
import { SCHEMA_UPGRADES, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { resetDb, v51StoreSpecs } from '../helpers'

const PLACEMENT = { canvasId: 1, x: 0, y: 0, width: 300, height: 200 }

const RAILS_WITH_REMOVED = {
  left: {
    orientation: 'vertical',
    slots: [
      // Active tab removed → first remaining tab becomes active.
      { id: 's1', flex: 2, activeTabId: 't-hz', tabs: [{ id: 't-lens', type: 'lens', listDefinitionId: 1 }, { id: 't-hz', type: 'horizons' }] },
      // Only removed tabs → slot disappears.
      { id: 's2', activeTabId: 't-sb', tabs: [{ id: 't-sb', type: 'scoreboard' }, { id: 't-sg', type: 'snoozeGraveyard' }] },
    ],
  },
  // Every slot removed → rail becomes null.
  right: { orientation: 'vertical', slots: [{ id: 's3', activeTabId: 't-hz2', tabs: [{ id: 't-hz2', type: 'horizons' }] }] },
  top: null,
  bottom: { orientation: 'horizontal', slots: [{ id: 's4', activeTabId: 't-st', tabs: [{ id: 't-st', type: 'status' }] }] },
  widths: { left: 320, right: 280 },
  collapsed: { right: true },
}

function v51DataSet(): DataSet {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: '2026-09-01T09:00:00.000Z' }],
    settings: [
      { key: 'themeMode', value: 'dark' },
      { key: 'horizonSlots', value: '[1,2]' },
      { key: 'selectedHorizonDefId', value: '1' },
      { key: 'canvasRails', value: JSON.stringify(RAILS_WITH_REMOVED) },
    ],
    floatingHorizons: [{ id: 1, ...PLACEMENT }],
    floatingScoreboard: [{ id: 1, ...PLACEMENT }],
    floatingSnoozeGraveyard: [{ id: 1, ...PLACEMENT }],
    floatingStatus: [{ id: 1, ...PLACEMENT }],
    floatingTaskboards: [{ id: 1, ...PLACEMENT }],
  }
}

describe('upgradeV52 (pure transform)', () => {
  it('is the v52 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(52)
    expect(SCHEMA_UPGRADES.get(52)).toBe(upgradeV52)
  })

  it('removes the three placement tables and the horizons settings rows', () => {
    const out = upgradeV52(v51DataSet())
    expect('floatingHorizons' in out).toBe(false)
    expect('floatingScoreboard' in out).toBe(false)
    expect('floatingSnoozeGraveyard' in out).toBe(false)
    expect(out.settings!.map((r) => r.key)).toEqual(['themeMode', 'canvasRails'])
  })

  it('leaves other tables as the same array reference', () => {
    const input = v51DataSet()
    const out = upgradeV52(input)
    expect(out.floatingStatus).toBe(input.floatingStatus)
    expect(out.floatingTaskboards).toBe(input.floatingTaskboards)
    expect(out.canvases).toBe(input.canvases)
  })

  it('rewrites the rails: drops removed tabs, empty slots and empty rails; keeps the rest', () => {
    const rails = JSON.parse(stripRemovedKindsFromRails(JSON.stringify(RAILS_WITH_REMOVED)))
    expect(rails.left.slots).toEqual([
      { id: 's1', flex: 2, activeTabId: 't-lens', tabs: [{ id: 't-lens', type: 'lens', listDefinitionId: 1 }] },
    ])
    expect(rails.right).toBeNull()
    expect(rails.top).toBeNull()
    expect(rails.bottom).toEqual(RAILS_WITH_REMOVED.bottom)
    expect(rails.widths).toEqual(RAILS_WITH_REMOVED.widths)
    expect(rails.collapsed).toEqual(RAILS_WITH_REMOVED.collapsed)
  })

  it('returns an untouched rails value (and settings array) unchanged', () => {
    const clean = JSON.stringify({ left: null, right: null, top: null, bottom: RAILS_WITH_REMOVED.bottom })
    expect(stripRemovedKindsFromRails(clean)).toBe(clean)
    expect(stripRemovedKindsFromRails('not json')).toBe('not json')
    const settings = [{ key: 'themeMode', value: 'dark' }, { key: 'canvasRails', value: clean }]
    expect(upgradeV52({ settings }).settings).toBe(settings)
  })

  it('is idempotent and does not mutate its input', () => {
    const input = v51DataSet()
    const snapshot = JSON.stringify(input)
    const once = upgradeV52(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    const twice = upgradeV52(once)
    expect(twice).toEqual(once)
    expect(twice.settings).toBe(once.settings)
  })

  it('tolerates partial datasets (task archives) and malformed rows', () => {
    expect(upgradeV52({})).toEqual({})
    const archive = { todos: [{ id: 1, title: 'X' }] }
    expect(upgradeV52(archive).todos).toBe(archive.todos)
    const odd = [null as never, 'junk' as never, { key: 'canvasRails', value: 42 }]
    expect(upgradeV52({ settings: odd }).settings).toBe(odd)
  })
})

/** The live-DB path: a v51 database opened by the current build. */
describe('v52 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV51Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v51 = new Dexie(db.name)
    v51.version(51).stores(v51StoreSpecs())
    await v51.open()
    const data = v51DataSet()
    for (const [table, rows] of Object.entries(data)) await v51.table(table).bulkAdd(rows)
    v51.close()
  }

  it('drops the tables, cleans settings, and matches the import path', async () => {
    await buildV51Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const backendStores = Array.from(db.backendDB().objectStoreNames)
    for (const dropped of ['floatingHorizons', 'floatingScoreboard', 'floatingSnoozeGraveyard']) {
      expect(backendStores).not.toContain(dropped)
    }

    const settings = await db.settings.orderBy('key').toArray()
    // `activeLayoutId` comes from the later v56 layout seed; v60 drops `canvasRails`.
    expect(settings.map((s) => s.key)).toEqual(['activeLayoutId', 'themeMode'])

    // The stripped rails (and the surviving floats) became the Default layout
    // at v56: no tab of a removed kind made it there.
    const [layout] = await db.layouts.toArray()
    const kinds = layout!.columns.flatMap((c) => c.cells.flatMap((cell) => cell.tabs.map((t) => t.kind)))
    expect([...new Set(kinds)].sort()).toEqual(['lens', 'status'])

    // A JSON copy of the same v51 data upgrades to the same settings and layout.
    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 51, todos: [], ...v51DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    const imported = [...prepared.data.settings].sort((a, b) => a.key.localeCompare(b.key))
    expect(imported).toEqual(settings)
    expect(prepared.data.layouts.map((l) => l.columns)).toEqual([layout!.columns])
    expect(prepared.warnings).toEqual([])
  })
})
