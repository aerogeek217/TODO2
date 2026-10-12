import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV56 } from '../../data/upgrades/v56-seed-workspace-layout'
import { SCHEMA_UPGRADES, upgradeDataSet, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { validateImportData } from '../../data/import-validation'
import { resetDb, v55StoreSpecs } from '../helpers'

const CREATED = new Date('2026-09-01T09:00:00.000Z')

function rails(r: Record<string, unknown>): DataRow {
  return { key: 'canvasRails', value: JSON.stringify({ left: null, right: null, top: null, bottom: null, ...r }) }
}

function slot(id: string, tabs: DataRow[], extra: DataRow = {}): DataRow {
  return { id, activeTabId: tabs[0]?.id, tabs, ...extra }
}

function v55DataSet(): DataSet {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: CREATED }],
    settings: [
      { key: 'themeMode', value: 'dark' },
      rails({
        left: { orientation: 'vertical', slots: [slot('L1', [{ id: 'lt', type: 'lens', listDefinitionId: 2, runtimeFilterValue: [3] }], { flex: 3 })] },
        top: { orientation: 'horizontal', slots: [slot('T1', [{ id: 'tt', type: 'notes' }], { flex: 5 })] },
        bottom: { orientation: 'horizontal', slots: [slot('B1', [{ id: 'bt', type: 'calendar' }], { weekOffset: 200, orientation: 'horizontal' })] },
        right: { orientation: 'vertical', slots: [slot('R1', [{ id: 'rt', type: 'status' }, { id: 'rt2', type: 'taskboard' }], { activeTabId: 'rt2' })] },
      }),
    ],
    listInsets: [{ id: 4, listDefinitionId: 2, canvasId: 1, x: 10, y: 50, width: 300, height: 200, isCollapsed: true }],
    floatingCalendars: [{ id: 2, canvasId: 1, x: 500, y: 10, width: 300, height: 200, weekOffset: -3 }],
    floatingNotes: [{ id: 1, canvasId: 1, x: 10, y: 10, width: 300, height: 200 }],
    floatingTaskboards: [],
    floatingStatus: [{ id: 1, canvasId: 2, x: 10, y: 50, width: 300, height: 200 }],
  }
}

function columnsOf(out: DataSet): Array<{ id: string; cells: Array<{ id: string; tabs: Array<{ id: string }> }> }> {
  return (out.layouts?.[0]?.columns ?? []) as never
}

/** Tab ids per cell per column. */
function shape(out: DataSet): string[][][] {
  return columnsOf(out).map((c) => c.cells.map((k) => k.tabs.map((t) => t.id)))
}

describe('upgradeV56 (pure)', () => {
  it('is registered for v56', () => {
    expect(SCHEMA_UPGRADES.get(56)).toBe(upgradeV56)
  })

  it('maps left / top+bottom / right rails to columns, then floats in canvas reading order', () => {
    const out = upgradeV56(v55DataSet())
    expect(shape(out)).toEqual([
      [['lt']],
      [['tt'], ['bt']],
      [['rt', 'rt2']],
      [['tab-floatingNotes-1'], ['tab-floatingCalendars-2'], ['tab-listInsets-4'], ['tab-floatingStatus-1']],
    ])
    const [left, middle, right, floats] = columnsOf(out) as unknown as Array<{ id: string; weight: number; cells: DataRow[] }>
    expect([left!.id, middle!.id, right!.id, floats!.id]).toEqual(['col-1', 'col-2', 'col-3', 'col-4'])
    // Vertical rails keep slot flex as the cell weight; horizontal rail slots don't.
    expect(left!.cells[0]!.weight).toBe(3)
    expect(middle!.cells.map((c) => c.weight)).toEqual([1, 1])
    expect(right!.cells[0]!.activeTabId).toBe('rt2')
    expect(left!.cells[0]!.tabs).toEqual([{ id: 'lt', kind: 'lens', config: { listDefinitionId: 2 }, viewState: { runtimeFilterValue: [3] } }])
    // Calendar: due only, week view at the clamped old offset; orientation dropped.
    expect(middle!.cells[1]!.tabs).toEqual([{ id: 'bt', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: 104 } }])
    expect(floats!.cells[1]!.tabs).toEqual([{ id: 'tab-floatingCalendars-2', kind: 'calendar', config: { dateTypes: { due: true, followup: false } }, viewState: { view: 'week', offset: -3 } }])
    // A collapsed inset is a collapsed cell; floats of every canvas are kept.
    expect(floats!.cells[2]).toMatchObject({ collapsed: true, tabs: [{ kind: 'lens', config: { listDefinitionId: 2 } }] })
    expect(floats!.cells[3]).not.toHaveProperty('collapsed')
  })

  it('writes one Default layout dated from the first canvas and points activeLayoutId at it', () => {
    const out = upgradeV56(v55DataSet())
    expect(out.layouts).toHaveLength(1)
    expect(out.layouts![0]).toMatchObject({ id: 1, name: 'Default', createdAt: CREATED, modifiedAt: CREATED })
    expect(out.settings).toContainEqual({ key: 'activeLayoutId', value: '1' })
    expect(out.settings!.filter((s) => s.key === 'activeLayoutId')).toHaveLength(1)
    // The canvas side is untouched.
    const input = v55DataSet()
    const again = upgradeV56(input)
    expect(again.listInsets).toBe(input.listInsets)
    expect(again.settings!.find((s) => s.key === 'canvasRails')).toBe(input.settings!.find((s) => s.key === 'canvasRails'))
  })

  it('passes import validation once the later upgrades ran', () => {
    const out = upgradeV56(v55DataSet())
    // v57 drops the saved prompt picks; v59 turns the taskboard tab into a
    // tab of the Focus list.
    const current = upgradeDataSet({ ...out, taskboards: [] }, 56, CURRENT_DB_VERSION)
    const res = validateImportData({ todos: [], ...current })
    if (!res.ok) throw new Error(res.error)
    expect(res.data.layouts[0]!.columns).toEqual(current.layouts![0]!.columns)
    expect(JSON.stringify(res.data.layouts)).not.toContain('runtimeFilterValue')
    expect(JSON.stringify(res.data.layouts)).not.toContain('taskboard')
  })

  it('no rails and no floats → an empty Default layout', () => {
    const out = upgradeV56({ canvases: [], settings: [] })
    expect(out.layouts).toEqual([{ id: 1, name: 'Default', columns: [], createdAt: new Date('2026-10-11T00:00:00.000Z'), modifiedAt: new Date('2026-10-11T00:00:00.000Z') }])
  })

  it('skips unknown kinds, empty slots / rails and unparseable rails; dedupes ids', () => {
    const data: DataSet = {
      settings: [rails({
        left: { orientation: 'vertical', slots: [
          slot('dup', [{ id: 'x', type: 'horizons' }]),
          slot('dup', [{ id: 'x', type: 'notes' }, { id: 'x', type: 'status' }, { type: 'lens' }, null as never]),
          'junk' as never,
        ] },
        right: { orientation: 'vertical', slots: [] },
      })],
    }
    const out = upgradeV56(data)
    expect(shape(out)).toEqual([[['x', 'x-2', 'tab']]])
    expect(columnsOf(out)[0]!.cells[0]!.id).toBe('dup')
    // Valid once the later upgrades ran (v62 retires the status tab).
    expect(validateImportData({ todos: [], settings: [], layouts: upgradeDataSet(out, 56, CURRENT_DB_VERSION).layouts }).ok).toBe(true)

    const broken = upgradeV56({ settings: [{ key: 'canvasRails', value: '{nope' }], floatingNotes: [{ id: 1, x: 0, y: 0 }] })
    expect(shape(broken)).toEqual([[['tab-floatingNotes-1']]])
  })

  it('idempotent: an existing layout means no change; partial datasets get no layout', () => {
    const seeded = upgradeV56(v55DataSet())
    expect(upgradeV56(seeded)).toBe(seeded)
    const archive: DataSet = { todos: [], todoPeople: [] }
    expect(upgradeV56(archive)).toBe(archive)
  })

  it('replaces a stray activeLayoutId row', () => {
    const out = upgradeV56({ settings: [{ key: 'activeLayoutId', value: '9' }] })
    expect(out.settings).toEqual([{ key: 'activeLayoutId', value: '1' }])
  })
})

/** The live-DB path: a v55 database opened by the current build. */
describe('v56 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  async function buildV55Db(): Promise<void> {
    db.close()
    await Dexie.delete(db.name)
    const v55 = new Dexie(db.name)
    v55.version(55).stores(v55StoreSpecs())
    await v55.open()
    for (const [table, rows] of Object.entries(v55DataSet())) {
      if (rows.length > 0) await v55.table(table).bulkAdd(rows)
    }
    v55.close()
  }

  it('creates the layouts table with the Default layout, matching the import path', async () => {
    await buildV55Db()
    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const layouts = await db.layouts.toArray()
    expect(layouts).toHaveLength(1)
    expect((await db.settings.get('activeLayoutId'))?.value).toBe('1')

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 55, todos: [], ...v55DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual([])
    expect(prepared.data.layouts).toEqual(layouts)
    const settings = await db.settings.orderBy('key').toArray()
    expect([...prepared.data.settings].sort((a, b) => a.key.localeCompare(b.key))).toEqual(settings)

    // New layouts continue after the seeded id.
    expect(await db.layouts.add({ name: 'Next', columns: [], createdAt: CREATED, modifiedAt: CREATED })).toBe(2)
  })

  it('a fresh database has no layout until one is ensured', async () => {
    expect(await db.layouts.count()).toBe(0)
  })
})
