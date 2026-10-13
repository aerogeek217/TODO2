import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { upgradeV62 } from '../../data/upgrades/v62-retire-status-widget'
import { SCHEMA_UPGRADES, type DataRow, type DataSet } from '../../data/schema-upgrades'
import { prepareImport } from '../../data/import-pipeline'
import { validateImportData } from '../../data/import-validation'
import { closeTab } from '../../utils/workspace-layout-ops'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { resetDb, v61StoreSpecs } from '../helpers'

const AT = new Date('2026-10-01T09:00:00.000Z')

const tab = (id: string, kind: string): DataRow => ({ id, kind, config: kind === 'calendar' ? { dateTypes: { due: true, followup: true } } : {} })

function layout(id: number, columns: unknown[]): DataRow {
  return { id, name: `L${id}`, columns, createdAt: AT, modifiedAt: AT }
}

function v61DataSet(): DataSet {
  return {
    layouts: [
      layout(1, [
        // Status is the active tab, between two others: the left one takes over.
        { id: 'c1', weight: 2, cells: [
          { id: 'k1', weight: 1, activeTabId: 's1', tabs: [tab('n1', 'notes'), tab('s1', 'status'), tab('e1', 'eisenhower')] },
          // A cell holding only a status tab goes; its column keeps the other cell.
          { id: 'k2', weight: 3, collapsed: true, tabs: [tab('s2', 'status')] },
        ] },
        // A column whose only cell held only status tabs goes.
        { id: 'c2', weight: 1, cells: [{ id: 'k3', weight: 1, tabs: [tab('s3', 'status'), tab('s4', 'status')] }] },
        // The status tab is the first one and active by default (no activeTabId).
        { id: 'c3', weight: 1, cells: [{ id: 'k4', weight: 1, tabs: [tab('s5', 'status'), tab('cal', 'calendar')] }] },
      ]),
      // No status tab: left alone.
      layout(2, [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [tab('n1', 'notes')] }] }]),
      // Only status tabs: an empty layout.
      layout(3, [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [tab('s1', 'status')] }] }]),
    ],
    settings: [{ key: 'activeLayoutId', value: '1' }],
  }
}

describe('upgradeV62 (pure)', () => {
  it('is the v62 registry entry', () => {
    expect(CURRENT_DB_VERSION).toBeGreaterThanOrEqual(62)
    expect(SCHEMA_UPGRADES.get(62)).toBe(upgradeV62)
  })

  it('drops every status tab like closing it: active tab moves, empty cells / columns go', () => {
    const out = upgradeV62(v61DataSet())
    expect(out.layouts![0]!.columns).toEqual([
      { id: 'c1', weight: 2, cells: [
        { id: 'k1', weight: 1, activeTabId: 'n1', tabs: [tab('n1', 'notes'), tab('e1', 'eisenhower')] },
      ] },
      { id: 'c3', weight: 1, cells: [{ id: 'k4', weight: 1, tabs: [tab('cal', 'calendar')] }] },
    ])
    expect(out.layouts![2]!.columns).toEqual([])
  })

  it('leaves layouts without status tabs and other tables as the same objects', () => {
    const input = v61DataSet()
    const out = upgradeV62(input)
    expect(out.layouts![1]).toBe(input.layouts![1])
    expect(out.settings).toBe(input.settings)
    expect(out.layouts![0]).toMatchObject({ id: 1, name: 'L1', createdAt: AT, modifiedAt: AT })
  })

  it('the result passes import validation', () => {
    const out = upgradeV62(v61DataSet())
    expect(validateImportData({ todos: [], settings: [], layouts: out.layouts }).ok).toBe(true)
  })

  it('is idempotent and tolerates missing tables and malformed rows', () => {
    const once = upgradeV62(v61DataSet())
    expect(upgradeV62(once)).toBe(once)
    const archive: DataSet = { todos: [], todoPeople: [] }
    expect(upgradeV62(archive)).toBe(archive)
    const junk: DataSet = {
      layouts: [
        null as never,
        { id: 1, columns: 'nope' },
        { id: 2, columns: [{ id: 'c', cells: [{ id: 'k', tabs: 'x' }] }] },
        { id: 3, columns: [{ id: 'c', cells: [{ id: 'k', tabs: [tab('s', 'status'), 7] }] }] },
      ],
    }
    expect(upgradeV62(junk)).toBe(junk)
  })

  it('gives the same layout as closing each status tab in turn, on many random layouts', () => {
    // Deterministic pseudo-random layouts: 1–3 columns of 1–3 cells of 0–5
    // tabs, each tab a status tab or not, any of them (or none) active.
    let seed = 7
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let round = 0; round < 500; round++) {
      let nextId = 0
      const columns = Array.from({ length: 1 + rand(3) }, () => ({
        id: `c${nextId++}`, weight: 1,
        cells: Array.from({ length: 1 + rand(3) }, () => {
          const tabs = Array.from({ length: rand(6) }, () => tab(`t${nextId++}`, rand(2) === 0 ? 'status' : 'notes'))
          const active = rand(tabs.length + 1)
          return { id: `k${nextId++}`, weight: 1, tabs, ...(active < tabs.length ? { activeTabId: tabs[active]!.id } : {}) }
        }),
      }))
      const row = layout(1, columns)
      let expected = row as unknown as WorkspaceLayout
      for (const col of columns) for (const cell of col.cells) for (const t of cell.tabs) {
        if (t.kind === 'status') expected = closeTab(expected, t.id as string)
      }
      const [out] = upgradeV62({ layouts: [row] }).layouts!
      expect(out, JSON.stringify(columns)).toEqual(expected)
    }
  })

  it('stays linear on a layout with a huge number of status tabs', () => {
    const tabs = Array.from({ length: 200_000 }, (_, i) => tab(`s${i}`, 'status'))
    tabs.push(tab('n', 'notes'))
    const row = layout(1, [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 's0', tabs }] }])
    // Closing them one by one took ~10^10 steps; one pass is instant. The
    // timeout leaves plenty of room on a loaded machine.
    const [out] = upgradeV62({ layouts: [row] }).layouts!
    expect(out!.columns).toEqual([{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, activeTabId: 'n', tabs: [tab('n', 'notes')] }] }])
  }, 20_000)
})

/** The live-DB path: a v61 database opened by the current build. */
describe('v62 Dexie upgrade', () => {
  afterEach(async () => {
    await resetDb()
  })

  it('drops the stored status tabs, matching the import path', async () => {
    db.close()
    await Dexie.delete(db.name)
    const v61 = new Dexie(db.name)
    v61.version(61).stores(v61StoreSpecs())
    await v61.open()
    for (const [table, rows] of Object.entries(v61DataSet())) {
      if (rows.length > 0) await v61.table(table).bulkAdd(rows)
    }
    v61.close()

    await db.open()
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    const layouts = await db.layouts.orderBy('id').toArray()
    expect(layouts.map((l) => l.columns.flatMap((c) => c.cells.flatMap((k) => k.tabs.map((t) => t.id))))).toEqual([
      ['n1', 'e1', 'cal'],
      ['n1'],
      [],
    ])

    const prepared = prepareImport(JSON.parse(JSON.stringify({ __schemaVersion: 61, todos: [], ...v61DataSet() })) as unknown)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.data.layouts).toEqual(layouts)
  })
})
