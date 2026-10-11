import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../data/database'
import { auditData, cleanupIssues, MAX_SAMPLES_PER_ISSUE } from '../../data/audit'
import { emptyPredicate } from '../../stores/list-definition-store'
import { makeTodo } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

/** Seed a todo so join rows have a valid target. Returns its id. */
async function seedBase() {
  const todoId = await db.todos.add(makeTodo() as any)
  return { todoId: todoId as number }
}

describe('auditData', () => {
  it('reports no issues on clean data', async () => {
    const { todoId } = await seedBase()
    const personId = await db.people.add({ name: 'Alice', initials: 'A', color: '#000' } as any)
    await db.todoPeople.add({ todoId, personId })
    const listDefinitionId = await db.listDefinitions.add({
      name: 'Focus', sortOrder: 0, pinnedToDashboard: true, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), focus: true } },
    })
    await db.listOrders.add({ listDefinitionId, todoId, rank: 1 })

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

  it('detects orphaned todoEvents (deleted todo)', async () => {
    await db.todoEvents.add({ todoId: 999, type: 'created', fromValue: null, toValue: null, timestamp: new Date().toISOString() })

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todoEvents')!
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('delete')
  })

  // --- Dangling foreign keys ---

  it('detects todos with deleted statusId', async () => {
    await db.todos.add(makeTodo({ statusId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'statusId')!
    expect(issue).toBeDefined()
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
  })

  it('ignores todos with valid statusId', async () => {
    const statusId = await db.statuses.add({ name: 'Open', color: '#00ff00', sortOrder: 0 } as any)
    await db.todos.add(makeTodo({ statusId }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'statusId')).toBeUndefined()
  })

  it('ignores todos with null/undefined statusId', async () => {
    await db.todos.add(makeTodo() as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'statusId')).toBeUndefined()
  })

  // --- Multiple issue types at once ---

  it('detects multiple issue types in one scan', async () => {
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoTags.add({ todoId: 999, tagId: 888 })
    await db.listOrders.add({ listDefinitionId: 555, todoId: 999, rank: 1 })
    await db.todos.add(makeTodo({ statusId: 777 }) as any)

    const report = await auditData()
    expect(report.issues.length).toBeGreaterThanOrEqual(3)
    expect(report.totalOrphans).toBeGreaterThanOrEqual(4)
  })

})

describe('cleanupIssues', () => {
  it('deletes orphaned join rows and list ranks', async () => {
    await db.todoPeople.add({ todoId: 999, personId: 888 })
    await db.todoTags.add({ todoId: 999, tagId: 888 })
    await db.listOrders.add({ listDefinitionId: 555, todoId: 999, rank: 1 })

    const report = await auditData()
    expect(report.totalOrphans).toBe(3)

    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(3)

    expect(await db.todoPeople.count()).toBe(0)
    expect(await db.todoTags.count()).toBe(0)
    expect(await db.listOrders.count()).toBe(0)
  })

  it('clears dangling statusId on todos', async () => {
    const todoId = await db.todos.add(makeTodo({ statusId: 999 }) as any)

    const report = await auditData()
    await cleanupIssues(report.issues)

    const todo = await db.todos.get(todoId)
    expect(todo!.statusId).toBeUndefined()
    expect(todo!.title).toBe('Task') // rest of todo intact (canonical makeTodo's default)
  })

  it('deletes orphaned event-log entries, keeping the rest', async () => {
    const { todoId } = await seedBase()
    await db.todoEvents.add({ todoId, type: 'created', fromValue: null, toValue: null, timestamp: new Date().toISOString() })
    await db.todoEvents.add({ todoId: 999, type: 'created', fromValue: null, toValue: null, timestamp: new Date().toISOString() })

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBe(1)

    expect((await db.todoEvents.toArray()).map((ev) => ev.todoId)).toEqual([todoId])
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
    await db.todoTags.add({ todoId: 999, tagId: 888 })
    await db.listOrders.add({ listDefinitionId: 555, todoId: 999, rank: 1 })
    await db.todos.add(makeTodo({ statusId: 777 }) as any)

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
    await db.todos.add(makeTodo({ statusId: 999 }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.field === 'statusId')!
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields).toEqual(['statusId'])
    expect(issue.samples![0]!.row.statusId).toBe(999)
    expect(issue.samples![0]!.note).toBe('statusId 999 not in statuses')
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
    // A person requires initials.
    await db.people.add({ name: 'No initials' } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.startsWith('Rows in "people"'))!
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields).toEqual(['initials'])
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
// shape the validators reject (e.g. a person without initials) is flagged for
// deletion.
describe('unknown-row audit', () => {
  it('detects rows in a known table that fail current schema validation', async () => {
    // Bad shape: a person requires initials.
    await db.people.add({ name: 'No initials' } as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.description.startsWith('Rows in "people"'))!
    expect(issue).toBeDefined()
    expect(issue.fix).toBe('delete')
    expect(issue.count).toBe(1)
    expect(issue.ids).toHaveLength(1)
  })

  it('cleanup removes unknown rows but preserves valid ones', async () => {
    // Bad row (missing initials)
    await db.people.add({ name: 'No initials' } as any)
    // Valid row
    await db.people.add({ name: 'Alice', initials: 'AL' })

    const report = await auditData()
    await cleanupIssues(report.issues)

    const remaining = await db.people.toArray()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.name).toBe('Alice')
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
// (e.g. a malformed `weekStartsOn` carried over from an older DB).
// These slip through both the unknown-row pass (skips settings entirely) and
// the unknown-key pass (key is recognised) — this dedicated pass closes the
// gap so the user can drop them via audit cleanup.
describe('invalid-setting-value audit', () => {
  it('flags a recognised settings key whose value fails the per-key validator', async () => {
    // `weekStartsOn` must be 0 or 1.
    await db.settings.put({ key: 'weekStartsOn', value: '5' })

    const report = await auditData()
    const issue = report.issues.find((i) =>
      i.description.startsWith('Settings rows whose value'),
    )!
    expect(issue).toBeDefined()
    expect(issue.fix).toBe('delete')
    expect(issue.keys).toEqual(['weekStartsOn'])
    expect(issue.count).toBe(1)
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields).toEqual(['value'])
    expect(issue.samples![0]!.note).toMatch(/weekStartsOn must be 0 or 1/)
  })

  it('does not flag valid settings rows', async () => {
    await db.settings.put({ key: 'weekStartsOn', value: '1' })
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
    await db.settings.put({ key: 'weekStartsOn', value: '5' })
    await db.settings.put({ key: 'themeMode', value: 'dark' })

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBeGreaterThanOrEqual(1)

    expect(await db.settings.get('weekStartsOn')).toBeUndefined()
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

  it('flags a store of a removed table (projects) as unknown', async () => {
    sideDb = new Dexie('audit-unknown-' + Math.random().toString(36).slice(2))
    sideDb.version(1).stores({ projects: '++id', todos: '++id' })
    await sideDb.open()
    await sideDb.table('projects').add({ name: 'Work' })

    vi.spyOn(db, 'backendDB').mockReturnValue(sideDb.backendDB())

    const report = await auditData()
    const dropped = report.issues.filter((i) => i.fix === 'drop-store').map((i) => i.table)
    expect(dropped).toEqual(['projects'])
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

// --- Orphan-recurrence-rule audit: a `recurrenceRule` is dead weight on a row
// that has no due date because `recurrenceAnchor` returns null and
// `advanceRecurring` short-circuits. The repository invariant
// (`todoRepository.update` / `bulkUpdate`) drops the rule on new writes; this
// audit pass detects + cleans rows that pre-date the invariant or were written
// by a path that bypassed the repository.
describe('orphan-recurrence-rule audit', () => {
  const followup = new Date(2026, 5, 1)

  it('detects a recurring task whose only date is a follow-up', async () => {
    await db.todos.add(makeTodo({
      nextFollowupAt: followup,
      recurrenceRule: { type: 'weekly' },
    }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'recurrenceRule')!
    expect(issue).toBeDefined()
    expect(issue.count).toBe(1)
    expect(issue.fix).toBe('clear-field')
    expect(issue.samples).toHaveLength(1)
    expect(issue.samples![0]!.badFields).toEqual(['recurrenceRule'])
    expect(issue.samples![0]!.note).toMatch(/no anchor/)
  })

  it('detects a recurring task with no dates at all', async () => {
    await db.todos.add(makeTodo({
      recurrenceRule: { type: 'monthly', originalDayOfMonth: 15 },
    }) as any)

    const report = await auditData()
    const issue = report.issues.find((i) => i.table === 'todos' && i.field === 'recurrenceRule')!
    expect(issue.count).toBe(1)
  })

  it('does not flag a recurring task anchored on a due date', async () => {
    await db.todos.add(makeTodo({
      dueDate: new Date(2026, 5, 10),
      recurrenceRule: { type: 'weekly' },
    }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'recurrenceRule')).toBeUndefined()
  })

  it('does not flag a non-recurring task without a due date', async () => {
    await db.todos.add(makeTodo({
      nextFollowupAt: followup,
    }) as any)

    const report = await auditData()
    expect(report.issues.find((i) => i.field === 'recurrenceRule')).toBeUndefined()
  })

  it('cleanup strips recurrenceRule and leaves the rest of the row intact', async () => {
    const todoId = await db.todos.add(makeTodo({
      title: 'Stale recurring',
      nextFollowupAt: followup,
      recurrenceRule: { type: 'weekly' },
    }) as any) as number

    const report = await auditData()
    const cleaned = await cleanupIssues(report.issues)
    expect(cleaned).toBeGreaterThanOrEqual(1)

    const after = await db.todos.get(todoId)
    expect(after!.recurrenceRule).toBeUndefined()
    expect(after!.title).toBe('Stale recurring')
    expect(after!.nextFollowupAt).toEqual(followup)
  })

  it('is idempotent: re-running audit after cleanup reports no recurrence issues', async () => {
    await db.todos.add(makeTodo({
      nextFollowupAt: followup,
      recurrenceRule: { type: 'weekly' },
    }) as any)

    const first = await auditData()
    expect(first.issues.find((i) => i.field === 'recurrenceRule')).toBeDefined()

    await cleanupIssues(first.issues)

    const second = await auditData()
    expect(second.issues.find((i) => i.field === 'recurrenceRule')).toBeUndefined()
  })
})

// --- Idempotency: running audit + cleanup twice yields zero issues on the
// second pass. Covers unknown-row and unknown-setting (drop-store is mocked
// elsewhere; idempotency holds for it too because raw IDB clear() is a no-op
// on an empty store).
describe('audit idempotency with unknown items', () => {
  it('audit + cleanup twice yields no issues on the second pass', async () => {
    await db.people.add({ name: 'No initials' } as any)
    await db.settings.put({ key: 'legacyDashboard', value: 'x' })

    const first = await auditData()
    expect(first.totalOrphans).toBeGreaterThan(0)
    await cleanupIssues(first.issues)

    const second = await auditData()
    expect(second.totalOrphans).toBe(0)
    expect(second.issues).toHaveLength(0)
  })
})
