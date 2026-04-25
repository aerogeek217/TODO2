import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { restoreFromImportData } from '../../data/restore'
import { validateImportData, type ImportData } from '../../data/import-validation'

/**
 * End-to-end round-trip: pre-v21 legacy data → import → export → re-import.
 * Verifies that:
 *   - Q2 priority/hard-deadline → scheduled/deadline translation applies.
 *   - Priority list insets are deleted.
 *   - listDefinitions + seeded statuses are populated.
 *   - A second round (re-import of the already-migrated data) is a no-op.
 */

const now = new Date('2026-04-01T12:00:00Z')

function snapshotTable<T>(rows: T[]): T[] {
  return rows
    .map((r) => ({ ...(r as object) }) as T)
    .sort((a, b) => {
      const aid = (a as unknown as { id?: number }).id ?? 0
      const bid = (b as unknown as { id?: number }).id ?? 0
      return aid - bid
    })
}

async function readAllTables() {
  const [
    todos, projects, canvases, listInsets, people, settings,
    todoPeople, todoOrgs, personOrgs, orgs, notes,
    taskboards, statuses, listDefinitions,
  ] = await Promise.all([
    db.todos.toArray(), db.projects.toArray(), db.canvases.toArray(),
    db.listInsets.toArray(), db.people.toArray(), db.settings.toArray(),
    db.todoPeople.toArray(),
    db.todoOrgs.toArray(), db.personOrgs.toArray(), db.orgs.toArray(),
    db.notes.toArray(),
    db.taskboards.toArray(), db.statuses.toArray(),
    db.listDefinitions.toArray(),
  ])
  return {
    todos: snapshotTable(todos),
    projects: snapshotTable(projects),
    canvases: snapshotTable(canvases),
    listInsets: snapshotTable(listInsets),
    people: snapshotTable(people),
    settings: snapshotTable(settings),
    todoPeople: snapshotTable(todoPeople),
    todoOrgs: snapshotTable(todoOrgs),
    personOrgs: snapshotTable(personOrgs),
    orgs: snapshotTable(orgs),
    notes: snapshotTable(notes),
    taskboards: snapshotTable(taskboards),
    statuses: snapshotTable(statuses),
    listDefinitions: snapshotTable(listDefinitions),
  }
}

/** Build a legacy-shaped ImportData (pre-v21, pre-v20). */
function makeLegacyImport(): ImportData {
  return {
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: now }],
    projects: [
      { id: 1, name: 'Work', canvasId: 1, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: now },
    ],
    todos: [
      // v19 legacy: starred boolean (should become seeded Follow-up status)
      {
        id: 100,
        title: 'Starred task',
        isCompleted: false,
        sortOrder: 0,
        createdAt: now,
        modifiedAt: now,
        canvasId: 1,
        projectId: 1,
        // v19 fields:
        isStarred: true,
        // v20 fields:
        priority: 0,
      },
      // v20 legacy: hard deadline with dueDate → stays deadline
      {
        id: 101,
        title: 'Hard deadline',
        isCompleted: false,
        sortOrder: 1,
        createdAt: now,
        modifiedAt: now,
        canvasId: 1,
        projectId: 1,
        priority: 2,
        dueDate: new Date('2026-04-20T00:00:00Z'),
        isHardDeadline: true,
      },
      // v20 legacy: soft deadline + no recurrence → becomes scheduled
      {
        id: 102,
        title: 'Soft deadline',
        isCompleted: false,
        sortOrder: 2,
        createdAt: now,
        modifiedAt: now,
        canvasId: 1,
        projectId: 1,
        priority: 1,
        dueDate: new Date('2026-04-22T00:00:00Z'),
        isHardDeadline: false,
      },
      // v20 legacy: recurrence + soft → recurrence forces deadline
      {
        id: 103,
        title: 'Recurring soft',
        isCompleted: false,
        sortOrder: 3,
        createdAt: now,
        modifiedAt: now,
        canvasId: 1,
        projectId: 1,
        priority: 0,
        dueDate: new Date('2026-04-25T00:00:00Z'),
        isHardDeadline: false,
        recurrenceRule: { type: 'weekly' },
      },
      // v20 legacy: no dates, priority set → nothing date-related after translation
      {
        id: 104,
        title: 'Priority only',
        isCompleted: false,
        sortOrder: 4,
        createdAt: now,
        modifiedAt: now,
        canvasId: 1,
        projectId: 1,
        priority: 2,
      },
    ] as unknown as ImportData['todos'],
    people: [],
    // Legacy list insets that must be deleted on import
    listInsets: [
      { id: 10, name: 'High Priority', preset: 'high-priority', canvasId: 1, x: 0, y: 0, width: 280, height: 300, isCollapsed: false } as unknown as ImportData['listInsets'][number],
      { id: 11, name: 'P2', attributeFilter: { type: 'priority', priority: 2 }, canvasId: 1, x: 0, y: 300, width: 280, height: 300, isCollapsed: false } as unknown as ImportData['listInsets'][number],
      { id: 12, name: 'Due this week', preset: 'due-this-week', canvasId: 1, x: 0, y: 600, width: 280, height: 300, isCollapsed: false },
    ],
    todoPeople: [],
    todoOrgs: [],
    personOrgs: [],
    settings: [],
    orgs: [],
    savedViews: [],  // Pre-v39 shape; translated to favorited list-defs on restore
    stickyNotes: [],
    taskboardEntries: [],
    taskboards: [],
    floatingTaskboards: [],
    statuses: [],
    // Empty — restore should auto-seed the four rows
    listDefinitions: [],
    notes: [],
    floatingCalendars: [],
    floatingNotes: [],
    floatingHorizons: [],
  }
}

describe('Unified scheduling round-trip (v19/v20 → v21)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('applies Q2 translations on first import', async () => {
    const legacy = makeLegacyImport()
    // Legacy JSON must still pass the validator (accepts both shapes)
    const validated = validateImportData(JSON.parse(JSON.stringify(legacy)))
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    await restoreFromImportData(validated.data)

    const todos = await db.todos.toArray()
    const byId = new Map(todos.map((t) => [t.id, t as unknown as Record<string, unknown>]))

    // Dates may round-trip through JSON as ISO strings; compare by parsed timestamp.
    const asTime = (d: unknown) => d == null ? null : new Date(d as string).getTime()

    // Starred → seeded Follow-up status
    expect('priority' in byId.get(100)!).toBe(false)
    expect('isStarred' in byId.get(100)!).toBe(false)
    expect(byId.get(100)!.statusId).toBeTypeOf('number')

    // Hard deadline stays as deadline, priority dropped
    expect(asTime(byId.get(101)!.dueDate)).toBe(new Date('2026-04-20T00:00:00Z').getTime())
    expect(byId.get(101)!.scheduledDate).toBeUndefined()
    expect('priority' in byId.get(101)!).toBe(false)
    expect('isHardDeadline' in byId.get(101)!).toBe(false)

    // Soft deadline becomes scheduled
    expect(byId.get(102)!.dueDate).toBeUndefined()
    const sched = byId.get(102)!.scheduledDate as { kind: 'date'; value: string | Date }
    expect(sched.kind).toBe('date')
    expect(asTime(sched.value)).toBe(new Date('2026-04-22T00:00:00Z').getTime())

    // Recurrence forces deadline; scheduled stays undefined
    expect(asTime(byId.get(103)!.dueDate)).toBe(new Date('2026-04-25T00:00:00Z').getTime())
    expect(byId.get(103)!.scheduledDate).toBeUndefined()
    expect(byId.get(103)!.recurrenceRule).toEqual({ type: 'weekly' })

    // Priority-only: neither date set
    expect(byId.get(104)!.dueDate).toBeUndefined()
    expect(byId.get(104)!.scheduledDate).toBeUndefined()
    expect('priority' in byId.get(104)!).toBe(false)
  })

  it('deletes priority list insets and preserves due-this-week', async () => {
    const legacy = makeLegacyImport()
    const validated = validateImportData(JSON.parse(JSON.stringify(legacy)))
    if (!validated.ok) throw new Error(validated.error)
    await restoreFromImportData(validated.data)

    // v23: the `due-this-week` preset is translated into an inset referencing
    // a freshly-created unpinned ListDefinition (ID 10–12 are not preserved
    // across the translation). The surviving inset points at a custom def.
    const insets = await db.listInsets.toArray()
    expect(insets).toHaveLength(1)
    const survivor = insets[0] as unknown as Record<string, unknown>
    expect(survivor.listDefinitionId).toBeTypeOf('number')
    expect(survivor.preset).toBeUndefined()
    expect(survivor.attributeFilter).toBeUndefined()

    const def = await db.listDefinitions.get(survivor.listDefinitionId as number)
    expect(def?.membership.kind).toBe('custom')
    expect(def?.pinnedToDashboard).toBe(false)
  })

  it('auto-seeds listDefinitions and seeded statuses', async () => {
    const legacy = makeLegacyImport()
    const validated = validateImportData(JSON.parse(JSON.stringify(legacy)))
    if (!validated.ok) throw new Error(validated.error)
    await restoreFromImportData(validated.data)

    // Post-v24: seeded lists are the 5 horizon custom-predicate defs; the
    // v23-synthesized unpinned `custom` row from `due-this-week` inset
    // translation survives alongside them.
    const listDefinitions = await db.listDefinitions.toArray()
    const pinnedNames = listDefinitions
      .filter((d) => d.pinnedToDashboard)
      .map((d) => d.name).sort()
    expect(pinnedNames).toEqual(['Later', 'Next week', 'Rest of month', 'Someday', 'This week'])
    for (const d of listDefinitions) expect(d.membership.kind).toBe('custom')
    const unpinnedCount = listDefinitions.filter((d) => !d.pinnedToDashboard).length
    expect(unpinnedCount).toBe(1)

    const statuses = await db.statuses.toArray()
    const names = statuses.map((s) => s.name).sort()
    expect(names).toContain('Assigned')
    expect(names).toContain('Follow-up')
  })

  it('round-trips: re-importing post-migration data produces identical state', async () => {
    // 1) Restore legacy
    const legacy = makeLegacyImport()
    const firstValidated = validateImportData(JSON.parse(JSON.stringify(legacy)))
    if (!firstValidated.ok) throw new Error(firstValidated.error)
    await restoreFromImportData(firstValidated.data)

    // 2) Snapshot the migrated state
    const firstPass = await readAllTables()

    // 3) Export as JSON from current state (reading tables directly).
    //    We package it into ImportData shape so validateImportData accepts it.
    const exported: ImportData = {
      canvases: firstPass.canvases,
      projects: firstPass.projects,
      todos: firstPass.todos as unknown as ImportData['todos'],
      people: firstPass.people,
      listInsets: firstPass.listInsets,
      todoPeople: firstPass.todoPeople,
      todoOrgs: firstPass.todoOrgs,
      personOrgs: firstPass.personOrgs,
      settings: firstPass.settings as unknown as ImportData['settings'],
      orgs: firstPass.orgs,
      savedViews: [],
      stickyNotes: [],
      taskboardEntries: [],
      taskboards: firstPass.taskboards as unknown as ImportData['taskboards'],
      floatingTaskboards: [],
      statuses: firstPass.statuses,
      listDefinitions: firstPass.listDefinitions,
      notes: firstPass.notes as unknown as ImportData['notes'],
      floatingCalendars: [],
      floatingNotes: [],
      floatingHorizons: [],
    }

    // 4) Clear DB via a fresh open then bulk re-import
    await db.delete()
    await db.open()

    // 5) Validate + re-import
    const serialized = JSON.parse(JSON.stringify(exported))
    const secondValidated = validateImportData(serialized)
    expect(secondValidated.ok).toBe(true)
    if (!secondValidated.ok) return
    await restoreFromImportData(secondValidated.data)

    // 6) Compare second-pass state with first-pass (idempotent)
    const secondPass = await readAllTables()

    // Todos: keyed by id, schedule/deadline fields should match
    const firstTodos = new Map(firstPass.todos.map((t) => [t.id, t as unknown as Record<string, unknown>]))
    const secondTodos = new Map(secondPass.todos.map((t) => [t.id, t as unknown as Record<string, unknown>]))
    expect(secondTodos.size).toBe(firstTodos.size)
    for (const [id, a] of firstTodos) {
      const b = secondTodos.get(id)!
      expect(b).toBeDefined()
      expect(b.title).toBe(a.title)
      expect(JSON.stringify(b.scheduledDate)).toBe(JSON.stringify(a.scheduledDate))
      expect(JSON.stringify(b.dueDate)).toBe(JSON.stringify(a.dueDate))
      expect(b.statusId).toBe(a.statusId)
      expect('priority' in b).toBe(false)
      expect('isHardDeadline' in b).toBe(false)
    }

    // List insets: same set after second pass (priority ones already gone)
    expect(secondPass.listInsets.map((i) => i.id).sort()).toEqual(
      firstPass.listInsets.map((i) => i.id).sort(),
    )

    // List definitions: same set of membership kinds round-trip (seeder idempotent,
    // seededKey retired in v22).
    expect(secondPass.listDefinitions.map((d) => d.membership.kind).sort())
      .toEqual(firstPass.listDefinitions.map((d) => d.membership.kind).sort())

    // Seeded statuses: same names present
    expect(secondPass.statuses.map((s) => s.name).sort())
      .toEqual(firstPass.statuses.map((s) => s.name).sort())
  })
})
