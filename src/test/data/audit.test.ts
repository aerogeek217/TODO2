import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../data/database'
import { auditData, cleanupIssues, MAX_SAMPLES_PER_ISSUE } from '../../data/audit'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const now = new Date()

/** Seed a canvas + project + todo so FKs are valid. Returns their IDs. */
async function seedBase() {
  const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
  const projectId = await db.projects.add({ name: 'P', canvasId, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: now } as any)
  const todoId = await db.todos.add(makeTodo({ canvasId, projectId }) as any)
  return { canvasId, projectId, todoId: todoId as number }
}

describe('auditData', () => {
  it('reports no issues on clean data', async () => {
    const { todoId } = await seedBase()
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    const orgId = await db.orgs.add({ name: 'Acme', color: '#00f' } as any)
    await db.todoPeople.add({ todoId, personId })
    await db.todoOrgs.add({ todoId, orgId })
    await db.personOrgs.add({ personId, orgId })
    await db.taskboards.add({ entries: [{ todoId, sortOrder: 0 }], createdAt: now, updatedAt: now })

    const report = await auditData()
    expect(report.totalOrphans).toBe(0)
    expect(report.issues).toHaveLength(0)
  })

  it('reports no issues on empty database', async () => {
    const report = await auditData()
    expect(report.totalOrphans).toBe(0)
  })

  // --- Orphaned join rows ---

  it('detects orphaned todoPeople (deleted todo)', async () => {
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    await db.todoPeople.add({ todoId: 999, personId })

    const report = await auditData()
    expect(report.totalOrphans).toBe(1)
    const issue = report.issues.find((i) => i.table === 'todoPeople')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects orphaned todoPeople (deleted person)', async () => {
    const { todoId } = await seedBase()
    await db.todoPeople.add({ todoId, personId: 999 })

    const report = await auditData()
    expect(report.totalOrphans).toBe(1)
    expect(report.issues.find((i) => i.table === 'todoPeople')).toBeDefined()
  })

  it('detects orphaned todoOrgs', async () => {
    await db.todoOrgs.add({ todoId: 999, orgId: 888 })

    const report = await auditData()
    expect(report.issues.find((i) => i.table === 'todoOrgs')!.count).toBe(1)
  })

  it('detects orphaned personOrgs', async () => {
    const orgId = await db.orgs.add({ name: 'Acme', color: '#00f' } as any)
    await db.personOrgs.add({ personId: 999, orgId })

    const report = await auditData()
    expect(report.issues.find((i) => i.table === 'personOrgs')!.count).toBe(1)
  })

  it('detects orphaned todoTags (deleted todo)', async () => {
    const tagId = await db.tags.add({ name: 'urgent', color: '#000' } as any)
    await db.todoTags.add({ todoId: 999, tagId })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todoTags')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects orphaned todoTags (deleted tag)', async () => {
    const { todoId } = await seedBase()
    await db.todoTags.add({ todoId, tagId: 999 })

    const report = await auditData()
    expect(report.issues.find((i) => i.table === 'todoTags')!.count).toBe(1)
  })

  it('detects floating horizons with deleted canvasId', async () => {
    await db.floatingHorizons.add({ canvasId: 999, x: 0, y: 0, width: 520, height: 360 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'floatingHorizons')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects orphaned taskboard entries referencing deleted todos', async () => {
    await db.taskboards.add({
      entries: [
        { todoId: 999, sortOrder: 0 },
        { todoId: 888, sortOrder: 1 },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'taskboards')!
    expect(issue.count).toBe(2)
    expect(issue.fix).toBe('clear-field')
  })

  // --- Dangling foreign keys ---

  it('detects todos with deleted projectId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId, projectId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'projectId')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
  })

  it('detects todos with deleted canvasId', async () => {
    await db.todos.add(makeTodo({ canvasId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'canvasId')!
    expect(issue.count).toBe(1)
  })

  it('detects projects with deleted canvasId', async () => {
    await db.projects.add({ name: 'P', canvasId: 999, positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 0, createdAt: now } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'projects' && i.field === 'canvasId')!
    expect(issue.count).toBe(1)
  })

  it('detects listInsets with deleted canvasId', async () => {
    await db.listInsets.add({ listDefinitionId: 1, canvasId: 999, x: 0, y: 0, width: 200, height: 200, isCollapsed: false } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'listInsets')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects floating notes with deleted canvasId', async () => {
    await db.floatingNotes.add({ canvasId: 999, x: 0, y: 0, width: 150, height: 150 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'floatingNotes')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects floating calendars with deleted canvasId', async () => {
    await db.floatingCalendars.add({ canvasId: 999, x: 0, y: 0, width: 200, height: 200 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'floatingCalendars')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  it('detects todos with deleted statusId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId, statusId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'statusId')!
    expect(issue).toBeDefined()
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
  })

  it('ignores todos with valid statusId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    const statusId = await db.statuses.add({ name: 'Open', color: '#00ff00', sortOrder: 0 } as any)
    await db.todos.add(makeTodo({ canvasId, statusId }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'statusId')).toBeUndefined()
  })

  it('ignores todos with null/undefined statusId', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'statusId')).toBeUndefined()
  })

  // --- Multiple issue types at once ---

  it('detects multiple issue types in one scan', async () => {
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoOrgs.add({ todoId: 999, orgId: 888 })
    await db.taskboards.add({ entries: [{ todoId: 999, sortOrder: 0 }], createdAt: now, updatedAt: now })
    await db.todos.add(makeTodo({ projectId: 777 }) as any)

    const report = await auditData()
    expect(report.issues.length).toBeGreaterThanOrEqual(3)
    expect(report.totalOrphans).toBeGreaterThanOrEqual(4)
  })

  it('treats null projectId without canvasId as valid (no issue)', async () => {
    await db.todos.add(makeTodo({}) as any) // no canvasId, no projectId

    const report = await auditData()
    expect(report.totalOrphans).toBe(0)
  })

  it('detects unplaced tasks (canvasId set but no projectId)', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.includes('not assigned to any project'))!
    expect(issue).toBeDefined()
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
    expect(issue.field).toBe('canvasId')
  })
})

describe('cleanupIssues', () => {
  it('deletes orphaned join rows and strips orphaned taskboard entries', async () => {
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoOrgs.add({ todoId: 999, orgId: 888 })
    const boardId = await db.taskboards.add({ entries: [{ todoId: 999, sortOrder: 0 }], createdAt: now, updatedAt: now })

    const report = await auditData()
    expect(report.totalOrphans).toBe(3)

    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(3)

    expect(await db.todoPeople.count()).toBe(0)
    expect(await db.todoOrgs.count()).toBe(0)
    const board = await db.taskboards.get(boardId)
    expect(board?.entries).toEqual([])
  })

  it('clears dangling projectId on todos', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    const todoId = await db.todos.add(makeTodo({ canvasId, projectId: 999 }) as any)

    const report = await auditData()
    await cleanupIssues(report.issues)

    const todo = await db.todos.get(todoId)
    expect(todo!.projectId).toBeUndefined()
    expect(todo!.title).toBe('Task') // rest of todo intact (canonical makeTodo's default)
  })

  it('clears dangling statusId on todos', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    const todoId = await db.todos.add(makeTodo({ canvasId, statusId: 999 }) as any)

    const report = await auditData()
    await cleanupIssues(report.issues)

    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBeUndefined()
    expect(todo!.title).toBe('Task')
  })

  it('deletes orphaned listInsets and floating notes', async () => {
    await db.listInsets.add({ listDefinitionId: 1, canvasId: 999, x: 0, y: 0, width: 200, height: 200, isCollapsed: false } as any)
    await db.floatingNotes.add({ canvasId: 999, x: 0, y: 0, width: 150, height: 150 } as any)

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(2)

    expect(await db.listInsets.count()).toBe(0)
    expect(await db.floatingNotes.count()).toBe(0)
  })

  it('deletes orphaned todoTags and floating horizons', async () => {
    await db.todoTags.add({ todoId: 999, tagId: 888 })
    await db.floatingHorizons.add({ canvasId: 999, x: 0, y: 0, width: 520, height: 360 } as any)

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(2)

    expect(await db.todoTags.count()).toBe(0)
    expect(await db.floatingHorizons.count()).toBe(0)
  })

  it('preserves valid data while cleaning orphans', async () => {
    const { todoId } = await seedBase()
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    // Valid join row
    await db.todoPeople.add({ todoId, personId })
    // Orphaned join row
    await db.todoPeople.add({ todoId: 999, personId })

    const report = await auditData()
    expect(report.totalOrphans).toBe(1)

    await cleanupIssues(report.issues)

    const remaining = await db.todoPeople.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.todoId).toBe(todoId)
  })

  it('database is clean after cleanup', async () => {
    // Seed multiple types of orphans
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoOrgs.add({ todoId: 999, orgId: 888 })
    await db.personOrgs.add({ personId: 999, orgId: 888 })
    await db.taskboards.add({ entries: [{ todoId: 999, sortOrder: 0 }], createdAt: now, updatedAt: now })
    // No canvasId so clearing dangling projectId won't create a new unplaced-task issue
    await db.todos.add(makeTodo({ projectId: 777 }) as any)

    const report = await auditData()
    expect(report.totalOrphans).toBeGreaterThan(0)

    await cleanupIssues(report.issues)

    // Re-audit should be clean
    const after = await auditData()
    expect(after.totalOrphans).toBe(0)
    expect(after.issues).toHaveLength(0)
  })

  it('returns 0 when no issues to clean', async () => {
    const cleaned = await cleanupIssues([])
    expect(cleaned).toBe(0)
  })
})

// --- Samples power the detail popup. Each issue carries up to
// MAX_SAMPLES_PER_ISSUE row-level records with bad-field hints so the popup
// can surface exactly what's wrong without re-querying the DB.
describe('audit samples', () => {
  it('flags the missing FK on an orphaned join row', async () => {
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    await db.todoPeople.add({ todoId: 999, personId })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todoPeople')!
    expect(issue.samples).toHaveLength(1)
    const sample = issue.samples![0]!
    expect(sample.badFields).toEqual(['todoId'])
    expect(sample.note).toContain('todoId 999 not in todos')
    expect(sample.row.todoId).toBe(999)
  })

  it('flags the dangling FK field on a row that will be cleared', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.todos.add(makeTodo({ canvasId, projectId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.field === 'projectId')!
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields).toEqual(['projectId'])
    expect(issue.samples![0]!.row.projectId).toBe(999)
  })

  it('returns one sample per offending taskboard entry, not per board', async () => {
    await db.taskboards.add({
      entries: [
        { todoId: 999, sortOrder: 0 },
        { todoId: 888, sortOrder: 1 },
      ],
      createdAt: now,
      updatedAt: now,
    })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'taskboards')!
    expect(issue.samples).toHaveLength(2)
    expect(issue.samples!.map((s) => s.row.todoId).sort()).toEqual([888, 999])
  })

  it('caps samples at MAX_SAMPLES_PER_ISSUE while ids covers every offender', async () => {
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    const offenderCount = MAX_SAMPLES_PER_ISSUE + 5
    for (let i = 0; i < offenderCount; i++) {
      await db.todoPeople.add({ todoId: 1000 + i, personId })
    }

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todoPeople')!
    expect(issue.count).toBe(offenderCount)
    expect(issue.ids).toHaveLength(offenderCount)
    expect(issue.samples).toHaveLength(MAX_SAMPLES_PER_ISSUE)
  })

  it('flags the bad field for unknown-row schema rejections', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    // listInsets requires listDefinitionId + isCollapsed.
    await db.listInsets.add({ canvasId, x: 0, y: 0, width: 100, height: 100 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.startsWith('Rows in "listInsets"'))!
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields!.length).toBeGreaterThan(0)
    expect(issue.samples![0]!.note).toMatch(/Schema validator rejected/)
  })

  it('attaches one sample per unrecognised setting key', async () => {
    await db.settings.put({ key: 'legacyDashboard', value: 'x' })
    await db.settings.put({ key: 'someOtherLegacy', value: 'y' })

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.startsWith('Unrecognized settings'))!
    expect(issue.samples).toHaveLength(2)
    const keys = issue.samples!.map((s) => s.row.key).sort()
    expect(keys).toEqual(['legacyDashboard', 'someOtherLegacy'])
    expect(issue.samples![0]!.badFields).toEqual(['key'])
  })
})

// --- Unknown-row detection: rows in known tables that the current schema rejects.
// `validateRow` runs every row through its per-table validator; a row whose
// shape no longer matches (e.g. listInset without `listDefinitionId` after the
// v23 strip) is flagged for deletion.
describe('unknown-row audit', () => {
  it('detects rows in a known table that fail current schema validation', async () => {
    // Seed a canvas so the canvas-orphan check doesn't ALSO flag this row.
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    // Bad shape: listDefinitionId + isCollapsed are required after P4.
    await db.listInsets.add({ canvasId, x: 0, y: 0, width: 100, height: 100 } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.startsWith('Rows in "listInsets"'))!
    expect(issue).toBeDefined()
    expect(issue.fix).toBe('delete')
    expect(issue.count).toBe(1)
    expect(issue.ids).toHaveLength(1)
  })

  it('cleanup removes unknown rows but preserves valid ones', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    // Bad row (missing listDefinitionId / isCollapsed)
    await db.listInsets.add({ canvasId, x: 0, y: 0, width: 100, height: 100 } as any)
    // Valid row
    await db.listInsets.add({ listDefinitionId: 1, canvasId, x: 10, y: 10, width: 100, height: 100, isCollapsed: false } as any)

    const report = await auditData()
    await cleanupIssues(report.issues)

    const remaining = await db.listInsets.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.x).toBe(10)
  })
})

// --- Unknown-setting detection: rows in `settings` whose `key` is not in the
// build's recognised set. Cleanup deletes by `key` (settings is keyed by string).
describe('unknown-setting audit', () => {
  it('detects unrecognised settings keys and reports them by key', async () => {
    await db.settings.put({ key: 'legacyDashboard', value: 'x' })
    await db.settings.put({ key: 'themeMode', value: 'dark' })

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.startsWith('Unrecognized settings'))!
    expect(issue).toBeDefined()
    expect(issue.fix).toBe('delete')
    expect(issue.keys).toEqual(['legacyDashboard'])
    expect(issue.count).toBe(1)
  })

  it('cleanup deletes unknown settings by key, leaving recognised ones intact', async () => {
    await db.settings.put({ key: 'legacyDashboard', value: 'x' })
    await db.settings.put({ key: 'themeMode', value: 'dark' })

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBeGreaterThanOrEqual(1)

    expect(await db.settings.get('legacyDashboard')).toBeUndefined()
    expect(await db.settings.get('themeMode')).toBeDefined()
  })
})

// --- Invalid-setting-value detection: rows in `settings` whose `key` is in
// the build's recognised set but whose `value` fails the per-key validator
// (e.g. a legacy-map-shape `horizonSlots` carried over from a pre-strip DB).
// These slip through both the unknown-row pass (skips settings entirely) and
// the unknown-key pass (key is recognised) — this dedicated pass closes the
// gap so the user can drop them via audit cleanup.
describe('invalid-setting-value audit', () => {
  it('flags a recognised settings key whose value fails the per-key validator', async () => {
    // Legacy map shape — `horizonSlots` validator now requires an array.
    await db.settings.put({ key: 'horizonSlots', value: JSON.stringify({ thisweek: 1 }) })

    const report = await auditData()
    const issue = report.issues.find((i) =>
      i.description.startsWith('Settings rows whose value'),
    )!
    expect(issue).toBeDefined()
    expect(issue.fix).toBe('delete')
    expect(issue.keys).toEqual(['horizonSlots'])
    expect(issue.count).toBe(1)
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields).toEqual(['value'])
    expect(issue.samples![0]!.note).toMatch(/horizonSlots must be an array/)
  })

  it('does not flag valid settings rows', async () => {
    await db.settings.put({ key: 'horizonSlots', value: JSON.stringify([1, 2, 3]) })
    await db.settings.put({ key: 'themeMode', value: 'dark' })

    const report = await auditData()
    const issue = report.issues.find((i) =>
      i.description.startsWith('Settings rows whose value'),
    )
    expect(issue).toBeUndefined()
  })

  it('does not double-count an unrecognised key as an invalid value', async () => {
    await db.settings.put({ key: 'legacyDashboard', value: '{}' })

    const report = await auditData()
    const unknown = report.issues.find((i) =>
      i.description.startsWith('Unrecognized settings'),
    )!
    const invalid = report.issues.find((i) =>
      i.description.startsWith('Settings rows whose value'),
    )
    expect(unknown.keys).toEqual(['legacyDashboard'])
    expect(invalid).toBeUndefined()
  })

  it('cleanup deletes invalid-value rows by key, leaving valid ones intact', async () => {
    await db.settings.put({ key: 'horizonSlots', value: JSON.stringify({ thisweek: 1 }) })
    await db.settings.put({ key: 'themeMode', value: 'dark' })

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBeGreaterThanOrEqual(1)

    expect(await db.settings.get('horizonSlots')).toBeUndefined()
    expect(await db.settings.get('themeMode')).toBeDefined()
  })
})

// --- Unknown-table detection: rows in IDB object stores that the current
// schema does not register. We mock `db.backendDB()` to return a side Dexie
// instance whose IDB has an extra store; that bypasses the constraint that
// Dexie itself can only register stores at schema-version time.
describe('unknown-table audit', () => {
  let sideDb: Dexie | null = null

  afterEach(async () => {
    vi.restoreAllMocks()
    if (sideDb) {
      try { await sideDb.delete() } catch { /* ignore */ }
      sideDb = null
    }
  })

  it('detects rows in an IDB store the current schema does not know about', async () => {
    sideDb = new Dexie('audit-unknown-' + Math.random().toString(36).slice(2))
    sideDb.version(1).stores({ legacyFoo: '++id' })
    await sideDb.open()
    await sideDb.table('legacyFoo').add({ stale: 'data' })

    vi.spyOn(db, 'backendDB').mockReturnValue(sideDb.backendDB())

    const report = await auditData()
    const issue = report.issues.find((i) => i.fix === 'drop-store')!
    expect(issue).toBeDefined()
    expect(issue.table).toBe('legacyFoo')
    expect(issue.count).toBe(1)
    expect(issue.field).toBe('__store__')
  })

  it('cleanup clears every row from an unknown store', async () => {
    sideDb = new Dexie('audit-unknown-' + Math.random().toString(36).slice(2))
    sideDb.version(1).stores({ legacyFoo: '++id' })
    await sideDb.open()
    await sideDb.table('legacyFoo').add({ stale: 1 })
    await sideDb.table('legacyFoo').add({ stale: 2 })

    vi.spyOn(db, 'backendDB').mockReturnValue(sideDb.backendDB())

    const report = await auditData()
    await cleanupIssues(report.issues)

    expect(await sideDb.table('legacyFoo').count()).toBe(0)
  })
})

// --- Idempotency: running audit + cleanup twice yields zero issues on the
// second pass. Covers unknown-row and unknown-setting (drop-store is mocked
// elsewhere; idempotency holds for it too because raw IDB clear() is a no-op
// on an empty store).
describe('audit idempotency with unknown items', () => {
  it('audit + cleanup twice yields no issues on the second pass', async () => {
    const canvasId = await db.canvases.add({ name: 'C', sortOrder: 0, createdAt: now } as any)
    await db.listInsets.add({ canvasId, x: 0, y: 0, width: 100, height: 100 } as any)
    await db.settings.put({ key: 'legacyDashboard', value: 'x' })

    const first = await auditData()
    expect(first.totalOrphans).toBeGreaterThan(0)
    await cleanupIssues(first.issues)

    const second = await auditData()
    expect(second.totalOrphans).toBe(0)
    expect(second.issues).toHaveLength(0)
  })
})
