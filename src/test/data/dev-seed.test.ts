import { describe, it, expect, beforeEach } from 'vitest'
import { generateDevSeed, DEV_SEED_IDS, DEV_SEED_SCHEMA_VERSION, type DevSeed } from '../../../scripts/dev-seed'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { auditData } from '../../data/audit'
import { readCheckinFilterSetting } from '../../data/checkin-filter-shape'
import { ownerLayoutId } from '../../models/list-definition'
import { pickLayoutBody, type RawLayoutBody } from '../../data/layout-shape'
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
    // Planned tasks (the Planner's planned day, schema v85): open ones, around today — one missed, some today, some ahead.
    const planned = seed.todos.filter((t) => t.doDate !== undefined)
    expect(planned.length).toBeGreaterThanOrEqual(5)
    expect(planned.every((t) => !t.isCompleted)).toBe(true)
    const doDays = planned.map((t) => ms(t.doDate)).filter((v) => v !== undefined)
    expect(doDays.some((v) => v < todayMs), 'a Do day missed').toBe(true)
    expect(doDays.some((v) => v === todayMs), 'planned today').toBe(true)
    expect(doDays.some((v) => v > todayMs), 'planned ahead').toBe(true)
    expect(planned.some((t) => t.recurrenceRule !== undefined), 'a repeating task planned').toBe(true)
    // Held in Unplanned (schema v86): open tasks with a date, never beside a planned day.
    const held = seed.todos.filter((t) => t.unplanned !== undefined)
    expect(held.length).toBeGreaterThanOrEqual(2)
    expect(held.every((t) => t.unplanned === true && !t.isCompleted && t.doDate === undefined)).toBe(true)
    expect(held.every((t) => t.dueDate !== undefined || t.nextFollowupAt !== undefined)).toBe(true)
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

    // The history log H3 (D26) ran from before the first task: each task's
    // people and tags are logged as added with it.
    const since = Date.parse(seed.settings.find((r) => r.key === 'historyLogSince')?.value ?? '')
    expect(Math.min(...created.values())).toBeGreaterThan(since)
    for (const r of seed.todoPeople) {
      expect(seed.todoEvents.some((e) => e.todoId === r.todoId && e.type === 'person' && e.toValue === r.personId), `person ${String(r.id)}`).toBe(true)
    }
    for (const r of seed.todoTags) {
      expect(seed.todoEvents.some((e) => e.todoId === r.todoId && e.type === 'tag' && e.toValue === r.tagId), `tag ${String(r.id)}`).toBe(true)
    }
  })

  it('gives tasks a few status updates in place of Progress, never after today', () => {
    const seed = seedFor()
    expect(seed.todos.some((t) => 'progress' in t)).toBe(false)
    const perTask = new Map<number, number>()
    for (const u of seed.statusUpdates) perTask.set(u.todoId, (perTask.get(u.todoId) ?? 0) + 1)
    expect(perTask.size).toBeGreaterThanOrEqual(3)
    expect([...perTask.values()].every((n) => n >= 2)).toBe(true)
    expect(seed.statusUpdates.every((u) => Date.parse(u.date) <= TODAY.getTime())).toBe(true)
    expect(seed.statusUpdates.some((u) => u.followedUp === true)).toBe(true)
  })

  it('gives every list an owner: a layout that shows it', () => {
    const seed = seedFor()
    const shown = new Map(seed.layouts.map((l) => [l.id, new Set(
      l.cells
        .flatMap((p) => p.tabs.flatMap((t) => (t.kind === 'lens' && t.config.listDefinitionId !== undefined ? [t.config.listDefinitionId] : []))),
    )]))
    for (const def of seed.listDefinitions) {
      const layoutId = ownerLayoutId(def)
      expect(layoutId, def.name).toBeDefined()
      expect(shown.get(layoutId)?.has(def.id!), `${def.name} shown by its layout`).toBe(true)
    }
    // Nothing of the removed Eisenhower.
    expect(seed.settings.filter((r) => r.key.startsWith('eisenhower'))).toEqual([])
    expect(setting(seed, 'activeLayoutId')).toBe(String(DEV_SEED_IDS.layouts.default))
    // Tables with a fixed row, a collapsed row, cells spanning tracks (D26).
    expect(seed.layouts.some((l) => l.grid.rows.some((t) => t.px != null)), 'a fixed row').toBe(true)
    expect(seed.layouts.some((l) => l.grid.rows.some((t) => t.collapsed === true)), 'a collapsed row').toBe(true)
    expect(seed.layouts.some((l) => l.cells.some((c) => c.area.rowSpan > 1)), 'a cell spanning rows').toBe(true)
    const kinds = new Set(seed.layouts.flatMap((l) => l.cells)
      .flatMap((p) => p.tabs.map((t) => t.kind)))
    expect([...kinds].sort()).toEqual(['breakdown', 'calendar', 'clusters', 'lens', 'listwall', 'neglect', 'notes', 'number', 'pivot', 'planner', 'trend'])
  })

  it('shows the planned date: plans on and after real dates, a Planner filter, a list and a Number', () => {
    const seed = seedFor()
    const dayOf = (iso: string | undefined) => (iso === undefined ? undefined : new Date(iso).setHours(0, 0, 0, 0))
    const planned = seed.todos.filter((t) => t.doDate !== undefined)
    expect(planned.some((t) => dayOf(t.doDate) === dayOf(t.dueDate)), 'a plan on its due day').toBe(true)
    expect(planned.some((t) => t.dueDate !== undefined && dayOf(t.doDate)! > dayOf(t.dueDate)!), 'a plan after its due date').toBe(true)
    expect(planned.some((t) => t.nextFollowupAt !== undefined && dayOf(t.doDate)! > dayOf(t.nextFollowupAt)!), 'a plan after its follow-up').toBe(true)
    expect(planned.filter((t) => dayOf(t.doDate)! < TODAY.getTime()).length, 'Delayed').toBeGreaterThanOrEqual(2)
    expect(seed.todos.filter((t) => t.unplanned === true).length, 'held').toBeGreaterThanOrEqual(3)

    const tabs = seed.layouts.flatMap((l) => l.cells.flatMap((c) => c.tabs))
    const planner = tabs.find((t) => t.kind === 'planner')
    expect(planner?.kind === 'planner' ? planner.config.unplanned?.expression : undefined).toEqual({
      kind: 'or',
      items: [{ kind: 'priority', value: 'focus' }, { kind: 'tag', id: DEV_SEED_IDS.tags['quick-win'] }],
    })
    const list = seed.listDefinitions.find((d) => d.id === DEV_SEED_IDS.lists.planned)
    expect(list && { sort: list.sort, grouping: list.grouping }).toEqual({ sort: 'planned', grouping: 'planned' })
    expect(tabs.some((t) => t.kind === 'number' && t.config.filter.dates.planned !== undefined), 'a Number filtered by Planned').toBe(true)
  })

  it('shows a list tab at each zoom and a Neglect map by project, kept whole by the layout repair (D25)', () => {
    const seed = seedFor()
    const tabsOf = (l: DevSeed['layouts'][number]) => l.cells.flatMap((p) => p.tabs)
    const tabs = seed.layouts.flatMap(tabsOf)
    const zooms = tabs.flatMap((t) => (t.kind === 'lens' && t.viewState?.zoom ? [t.viewState.zoom] : []))
    expect([...new Set(zooms)].sort()).toEqual(['lines', 'rows', 'stacked'])
    const neglect = tabs.filter((t) => t.kind === 'neglect')
    expect(neglect).toHaveLength(1)
    const projectTagIds = seed.tags.filter((t) => t.name.startsWith('Project: ')).map((t) => t.id)
    expect(neglect[0]?.config).toEqual({ colourBy: { kind: 'tags', tagIds: projectTagIds }, untouchedDays: 14 })
    for (const layout of seed.layouts) {
      const picked = pickLayoutBody(JSON.parse(JSON.stringify(layout)) as RawLayoutBody)
      expect(picked.fixes, layout.name).toEqual([])
      expect(tabsOf(picked as unknown as DevSeed['layouts'][number]).map((t) => t.id), layout.name).toEqual(tabsOf(layout).map((t) => t.id))
    }
  })

  it('stores a check-in filter the app reads unchanged', () => {
    const seed = seedFor()
    const checkin = readCheckinFilterSetting(setting(seed, 'checkinTaskFilter')!)
    expect(checkin.fixes).toEqual([])
    expect(checkin.filter.statusIds).toEqual([DEV_SEED_IDS.statuses.parked])
    expect(checkin.filter.negate).toEqual({ statusIds: true })
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
