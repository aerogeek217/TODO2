import { describe, it, expect, beforeEach } from 'vitest'
import { generateDevSeed, DEV_SEED_IDS, type DevSeed } from '../../../scripts/dev-seed'
import { db, ALL_DATA_TABLES, CURRENT_DB_VERSION } from '../../data/database'
import { prepareImport } from '../../data/import-pipeline'
import { restoreFromImportData } from '../../data/restore'
import { resetDb } from '../helpers'

/**
 * The dev seed (`npm run seed:dev`, `scripts/dev-seed.ts`) is what manual
 * testing imports into the dev server. This keeps it importable: it must run
 * the full v49 → current pipeline with no validation errors or warnings.
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
  expect(prepared.sourceVersion).toBe(49)
  expect(prepared.legacy).toBeNull()
  expect(prepared.upgraded).toBe(true)
  expect(prepared.warnings).toEqual([])
  await restoreFromImportData(prepared.data)
}

function rows(seed: DevSeed, table: string): Record<string, unknown>[] {
  return (seed as unknown as Record<string, Record<string, unknown>[]>)[table] ?? []
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

  it('is a realistic v49 export covering the upgrade paths', () => {
    const seed = seedFor()
    expect(seed.__schemaVersion).toBe(49)
    expect(seed.todos.length).toBeGreaterThanOrEqual(140)
    expect(seed.people).toHaveLength(12)
    expect(seed.orgs.length).toBeGreaterThanOrEqual(3)
    expect(seed.personOrgs.length).toBeGreaterThan(0)
    expect(seed.todoOrgs.length).toBeGreaterThan(0)
    expect(seed.projects).toHaveLength(5)
    expect(seed.tags).toHaveLength(10)
    expect(seed.statuses.filter((s) => s.hideByDefault === true).length).toBeGreaterThanOrEqual(2)
    for (const kind of ['floatingHorizons', 'floatingScoreboard', 'floatingSnoozeGraveyard']) {
      expect(rows(seed, kind).length, kind).toBeGreaterThan(0)
    }

    const todayMs = TODAY.getTime()
    const due = seed.todos.filter((t) => typeof t.dueDate === 'string').map((t) => Date.parse(t.dueDate as string))
    expect(due.some((ms) => ms < todayMs), 'overdue').toBe(true)
    expect(due.some((ms) => ms === todayMs), 'due today').toBe(true)
    const sched = seed.todos.map((t) => t.scheduledDate as { kind?: string } | undefined)
    expect(sched.some((s) => s?.kind === 'date')).toBe(true)
    expect(sched.some((s) => s?.kind === 'fuzzy')).toBe(true)
    expect(seed.todos.some((t) => t.recurrenceRule && !t.dueDate && (t.scheduledDate as { kind?: string })?.kind === 'date'),
      'recurring task anchored only on a scheduled date').toBe(true)

    const retentionMs = 30 * 86_400_000
    const completedEvents = seed.todoEvents.filter((e) => e.type === 'completed').map((e) => Date.parse(e.timestamp as string))
    expect(completedEvents.some((ms) => todayMs - ms > retentionMs), 'old completions').toBe(true)
    expect(completedEvents.some((ms) => todayMs - ms < retentionMs), 'recent completions').toBe(true)

    // Every event belongs to an existing task and never predates it.
    const created = new Map(seed.todos.map((t) => [t.id, Date.parse(t.createdAt as string)]))
    for (const e of seed.todoEvents) {
      const c = created.get(e.todoId)
      expect(c, `event ${String(e.id)} todo`).toBeDefined()
      expect(Date.parse(e.timestamp as string), `event ${String(e.id)} time`).toBeGreaterThanOrEqual(c!)
    }
  })
})

describe('dev seed → prepareImport → restore', () => {
  it('upgrades to the current schema and restores every table', async () => {
    const seed = seedFor()
    await importSeed(seed)
    expect(db.verno).toBe(CURRENT_DB_VERSION)

    const count = (table: string) => rows(seed, table).length
    const expected: Record<string, number> = {
      todos: count('todos'),
      projects: 5,
      canvases: 1,
      listInsets: count('listInsets'),
      // v55: each org becomes a person; org assignments become person assignments.
      people: count('people') + count('orgs'),
      todoPeople: count('todoPeople') + count('todoOrgs'),
      // v52 drops the two horizons rows, v53 the follow-up pointer and the scheduled color;
      // v53 adds an explicit quickStatusId, v56 activeLayoutId.
      settings: count('settings') - 4 + 2,
      taskboards: 1,
      statuses: count('statuses'),
      listDefinitions: count('listDefinitions'),
      notes: 1,
      floatingCalendars: count('floatingCalendars'),
      floatingNotes: count('floatingNotes'),
      floatingTaskboards: count('floatingTaskboards'),
      floatingStatus: count('floatingStatus'),
      tags: count('tags'),
      todoTags: count('todoTags'),
      todoEvents: count('todoEvents'),
      layouts: 1,
    }
    for (const table of ALL_DATA_TABLES) {
      expect(await table.count(), `${table.name} count`).toBe(expected[table.name])
    }
  })

  it('applies the per-version transforms to the seed data', async () => {
    const seed = seedFor()
    await importSeed(seed)
    const todos = await db.todos.toArray()
    const byTitle = (title: string) => {
      const t = todos.find((x) => x.title === title)
      if (!t) throw new Error(`missing ${title}`)
      return t
    }

    // v51: uids everywhere; completedAt on every completed task.
    expect(new Set(todos.map((t) => t.uid)).size).toBe(todos.length)
    for (const t of todos) expect(t.isCompleted ? t.completedAt instanceof Date : !('completedAt' in t), `todo ${t.id}`).toBe(true)
    // No completed event → completedAt falls back to modifiedAt.
    const legacy = byTitle('Fix the broken link in the onboarding doc')
    expect(legacy.completedAt).toEqual(legacy.modifiedAt)
    expect(byTitle('Fix the CSV import edge case they reported').isCompleted).toBe(false)

    // v53: no scheduled dates; the scheduled-only recurring task is anchored on a due date.
    for (const t of todos) expect('scheduledDate' in t, `todo ${t.id}`).toBe(false)
    const metrics = byTitle('Weekly metrics email')
    expect(metrics.dueDate).toEqual(new Date(2026, 9, 12))
    expect(metrics.nextFollowupAt).toBeUndefined()
    // An aged fuzzy "this month" (picked last month) is an overdue follow-up.
    expect(byTitle('Clean up the shared drive').nextFollowupAt!.getTime()).toBeLessThan(TODAY.getTime())
    expect((await db.settings.get('quickStatusId'))?.value).toBe(String(DEV_SEED_IDS.statuses.followup))

    // v54: hide-by-status gone.
    for (const s of await db.statuses.toArray()) expect('hideByDefault' in s, s.name).toBe(false)

    // v55: orgs are people; org runtime prompts are person prompts.
    const people = await db.people.toArray()
    expect(people.filter((p) => p.name.startsWith('Org: ')).map((p) => p.name).sort())
      .toEqual(seed.orgs.map((o) => `Org: ${String(o.name)}`).sort())
    const lists = await db.listDefinitions.toArray()
    expect(lists.find((l) => l.name === 'By client')?.runtimeFilter).toEqual({ field: 'person', label: 'Client' })
  })

  it('produces the Default workspace layout from the rails and floating widgets', async () => {
    const seed = seedFor()
    await importSeed(seed)
    const layouts = await db.layouts.toArray()
    expect(layouts).toHaveLength(1)
    expect(layouts[0]!.name).toBe('Default')
    expect((await db.settings.get('activeLayoutId'))?.value).toBe(String(layouts[0]!.id))

    const columns = layouts[0]!.columns
    // Left rail, bottom rail, right rail, then one column of every surviving float.
    expect(columns.map((c) => c.cells.map((cell) => cell.id))).toEqual([
      ['s-focus', 's-cal'],
      ['s-stats', 's-client'],
      ['s-board'],
      expect.any(Array),
    ])
    const floats = rows(seed, 'listInsets').length + rows(seed, 'floatingCalendars').length
      + rows(seed, 'floatingNotes').length + rows(seed, 'floatingTaskboards').length + rows(seed, 'floatingStatus').length
    expect(columns[3]!.cells).toHaveLength(floats)
    // Removed kinds are gone from every cell.
    const kinds = columns.flatMap((c) => c.cells.flatMap((cell) => cell.tabs.map((t) => t.kind)))
    for (const removed of ['horizons', 'scoreboard', 'snoozeGraveyard']) expect(kinds).not.toContain(removed)
  })
})
