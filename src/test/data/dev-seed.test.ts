import { describe, it, expect, beforeEach } from 'vitest'
import { generateDevSeed, DEV_SEED_IDS, DEV_SEED_SCHEMA_VERSION, type DevSeed } from '../../../scripts/dev-seed'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { auditData } from '../../data/audit'
import { readCheckinFilterSetting } from '../../data/checkin-filter-shape'
import { readPanesSetting } from '../../data/eisenhower-shape'
import { isEisenhowerOwner, ownerLayoutId } from '../../models/list-definition'
import { resetDb } from '../helpers'

/**
 * The dev seed (`npm run seed:dev`, `scripts/dev-seed.ts`) is what manual
 * testing imports into the dev server. This keeps it importable: it is an
 * export in the current schema that imports with no validation errors or
 * warnings and leaves nothing for the audit to clean up.
 */

const TODAY = new Date(2026, 9, 11) // a Sunday

function seedFor(day: Date = TODAY): DevSeed {
  return generateDevSeed(day)
}

/** JSON round-trip, exactly what the import sees from the file. */
function asFile(seed: DevSeed): unknown {
  return JSON.parse(JSON.stringify(seed))
}

async function importSeed(seed: DevSeed): Promise<void> {
  const prepared = prepareImport(asFile(seed))
  if (!prepared.ok) throw new Error(`dev seed failed to import: ${prepared.error}`)
  expect(prepared.sourceVersion).toBe(CURRENT_DB_VERSION)
  expect(prepared.upgraded).toBe(false)
  expect(prepared.warnings).toEqual([])
  await restoreFromImportData(prepared.data)
}

function setting(seed: DevSeed, key: string): string | undefined {
  return seed.settings.find((s) => s.key === key)?.value
}

beforeEach(async () => {
  await resetDb()
})

describe('dev seed generator', () => {
  it('is deterministic for a day, whatever the time of day', () => {
    const morning = JSON.stringify(seedFor(new Date(2026, 9, 11, 6, 5)))
    const evening = JSON.stringify(seedFor(new Date(2026, 9, 11, 22, 40)))
    expect(evening).toBe(morning)
    expect(JSON.stringify(seedFor(new Date(2026, 9, 12)))).not.toBe(morning)
  })

  it('is written in the current schema', () => {
    expect(DEV_SEED_SCHEMA_VERSION).toBe(CURRENT_DB_VERSION)
    expect(seedFor().__schemaVersion).toBe(CURRENT_DB_VERSION)
  })

  it('is a realistic export', () => {
    const seed = seedFor()
    expect(seed.todos.length).toBeGreaterThanOrEqual(140)
    expect(new Set(seed.todos.map((t) => t.uid)).size).toBe(seed.todos.length)
    expect(seed.people).toHaveLength(16)
    expect(seed.people.filter((p) => p.name.startsWith('Org: '))).toHaveLength(4)
    const withEmail = seed.people.filter((p) => p.email !== undefined)
    expect(withEmail.length).toBeGreaterThanOrEqual(8)
    expect(withEmail.length).toBeLessThan(seed.people.length)
    expect(seed.tags.filter((t) => t.name.startsWith('Project: '))).toHaveLength(5)
    expect(seed.statuses).toHaveLength(4)

    const todayMs = TODAY.getTime()
    const ms = (iso: string | undefined) => (iso === undefined ? undefined : Date.parse(iso))
    const open = seed.todos.filter((t) => !t.isCompleted)
    const due = open.map((t) => ms(t.dueDate)).filter((v) => v !== undefined)
    expect(due.some((v) => v < todayMs), 'overdue').toBe(true)
    expect(due.some((v) => v === todayMs), 'due today').toBe(true)
    const next = open.map((t) => ms(t.nextFollowupAt)).filter((v) => v !== undefined)
    expect(next.some((v) => v < todayMs), 'overdue follow-up').toBe(true)
    expect(next.some((v) => v === todayMs), 'follow-up today').toBe(true)
    const exportedMs = Date.parse(seed.exportedAt)
    const last = seed.todos.map((t) => ms(t.lastFollowupAt)).filter((v) => v !== undefined)
    expect(last.length).toBeGreaterThan(0)
    for (const v of last) expect(v).toBeLessThanOrEqual(exportedMs)
    for (const flag of ['focus', 'urgent', 'important'] as const) {
      expect(open.some((t) => t[flag] === true), flag).toBe(true)
    }
    // A recurring task advances from its due date.
    for (const t of seed.todos.filter((x) => x.recurrenceRule)) expect(t.dueDate, t.title).toBeDefined()
    for (const t of seed.todos) expect(t.isCompleted === (t.completedAt !== undefined), t.title).toBe(true)

    const retentionMs = 30 * 86_400_000
    const completed = seed.todos.flatMap((t) => (t.completedAt ? [Date.parse(t.completedAt)] : []))
    expect(completed.some((v) => todayMs - v > retentionMs), 'old completions').toBe(true)
    expect(completed.some((v) => todayMs - v < retentionMs), 'recent completions').toBe(true)

    // Every event belongs to an existing task and never predates it.
    const created = new Map(seed.todos.map((t) => [t.id, Date.parse(t.createdAt)]))
    for (const e of seed.todoEvents) {
      const c = created.get(e.todoId)
      expect(c, `event ${String(e.id)} todo`).toBeDefined()
      expect(Date.parse(e.timestamp), `event ${String(e.id)} time`).toBeGreaterThanOrEqual(c!)
    }
  })

  it('gives every list an owner: a layout that shows it, or the Eisenhower', () => {
    const seed = seedFor()
    const shown = new Map(seed.layouts.map((l) => [l.id, new Set(
      [...l.columns.flatMap((c) => c.cells), ...(l.top ? [l.top] : []), ...(l.bottom ? [l.bottom] : [])]
        .flatMap((p) => p.tabs.flatMap((t) => (t.kind === 'lens' && t.config.listDefinitionId !== undefined ? [t.config.listDefinitionId] : []))),
    )]))
    for (const def of seed.listDefinitions) {
      if (isEisenhowerOwner(def.owner)) continue
      const layoutId = ownerLayoutId(def)
      expect(layoutId, def.name).toBeDefined()
      expect(shown.get(layoutId)?.has(def.id!), `${def.name} shown by its layout`).toBe(true)
    }
    const eisenhower = seed.listDefinitions.filter((d) => isEisenhowerOwner(d.owner))
    expect(eisenhower.map((d) => d.id)).toEqual([DEV_SEED_IDS.lists.eisenhower])
    expect(setting(seed, 'eisenhowerSource')).toBe(`list:${DEV_SEED_IDS.lists.eisenhower}`)
    expect(setting(seed, 'activeLayoutId')).toBe(String(DEV_SEED_IDS.layouts.default))
    expect(seed.layouts.some((l) => l.top) && seed.layouts.some((l) => l.bottom), 'bands').toBe(true)
    const kinds = new Set(seed.layouts.flatMap((l) => [...l.columns.flatMap((c) => c.cells), ...(l.top ? [l.top] : []), ...(l.bottom ? [l.bottom] : [])])
      .flatMap((p) => p.tabs.map((t) => t.kind)))
    expect([...kinds].sort()).toEqual(['calendar', 'dashboard', 'eisenhower', 'lens', 'notes'])
  })

  it('stores a check-in filter and Eisenhower panes the app reads unchanged', () => {
    const seed = seedFor()
    const checkin = readCheckinFilterSetting(setting(seed, 'checkinTaskFilter')!)
    expect(checkin.fixes).toEqual([])
    expect(checkin.filter.statusIds).toEqual([DEV_SEED_IDS.statuses.parked])
    expect(checkin.filter.negate).toEqual({ statusIds: true })
    const panes = readPanesSetting(setting(seed, 'eisenhowerPanes')!)
    expect(panes.fixes).toEqual([])
    expect(panes.panes).toEqual({ delegate: { name: 'Hand off' } })
  })
})

describe('dev seed → prepareImport → restore', () => {
  it('restores every table whole', async () => {
    const seed = seedFor()
    await importSeed(seed)
    expect(db.verno).toBe(CURRENT_DB_VERSION)
    for (const table of ALL_DATA_TABLES) {
      const rows = (seed as unknown as Record<string, unknown[]>)[table.name] ?? []
      expect(await table.count(), `${table.name} count`).toBe(rows.length)
    }
  })

  it('leaves nothing for the audit', async () => {
    await importSeed(seedFor())
    const report = await auditData()
    expect(report.issues.map((i) => `${i.table}: ${i.description}`)).toEqual([])
  })

  it('keeps the Focus list in its manual order', async () => {
    const seed = seedFor()
    await importSeed(seed)
    const focusIds = (await db.todos.toArray()).filter((t) => t.focus).map((t) => t.id)
    const ranks = (await db.listOrders.where('listDefinitionId').equals(DEV_SEED_IDS.lists.focus).toArray())
      .sort((a, b) => a.rank - b.rank)
    expect(ranks.map((r) => r.todoId).sort((a, b) => a - b)).toEqual([...focusIds].sort((a, b) => (a ?? 0) - (b ?? 0)))
    expect(ranks).toHaveLength(6)
  })
})
