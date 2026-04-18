import Dexie, { type Table, type Transaction } from 'dexie'
import type { TodoItem, Project, Canvas, Person, Tag, TodoTag, TodoPerson, TodoOrg, PersonOrg, ListInset, Org, Backup, SavedView, StickyNote, TaskboardEntry, Status } from '../models'
import type { ListDefinition } from '../models/list-definition'

export interface SettingRow {
  key: string
  value: string
}

export class Todo2Database extends Dexie {
  todos!: Table<TodoItem, number>
  projects!: Table<Project, number>
  canvases!: Table<Canvas, number>
  people!: Table<Person, number>
  settings!: Table<SettingRow, string>
  tags!: Table<Tag, number>
  todoTags!: Table<TodoTag, number>
  todoPeople!: Table<TodoPerson, number>
  listInsets!: Table<ListInset, number>
  orgs!: Table<Org, number>
  todoOrgs!: Table<TodoOrg, number>
  personOrgs!: Table<PersonOrg, number>
  backups!: Table<Backup, number>
  savedViews!: Table<SavedView, number>
  stickyNotes!: Table<StickyNote, number>
  taskboardEntries!: Table<TaskboardEntry, number>
  statuses!: Table<Status, number>
  listDefinitions!: Table<ListDefinition, number>

  constructor() {
    super('todo2')

    // v16: base schema — all tables (backward compat cutoff: 2026-04-10)
    this.version(16).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder',
      projects: '++id, canvasId, sortOrder',
      canvases: '++id, sortOrder',
      people: '++id, name',
      settings: 'key',
      tags: '++id, name',
      todoTags: '++id, todoId, tagId',
      todoPeople: '++id, todoId, personId',
      todoOrgs: '++id, todoId, orgId',
      personOrgs: '++id, personId, orgId',
      listInsets: '++id, canvasId',
      orgs: '++id, name',
      backups: '++id, createdAt, trigger',
      savedViews: '++id, sortOrder',
      stickyNotes: '++id, canvasId',
    })

    // v17: add initials field to orgs (no index change, field stored inline)
    this.version(17).stores({})

    // v18: add taskboardEntries table for ordered task queue
    this.version(18).stores({
      taskboardEntries: '++id, todoId, sortOrder',
    })

    // v19: add statuses table and statusId index on todos
    this.version(19).stores({
      statuses: '++id, sortOrder',
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder, statusId',
    })

    // v20: unify Status — drop isStarred index; seed Assigned/Followup statuses;
    // fold isStarred/isAssigned into statusId; delete retired 'starred' list-inset preset.
    this.version(20).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, dueDate, sortOrder, statusId',
      statuses: '++id, sortOrder',
      listInsets: '++id, canvasId',
      settings: 'key',
    }).upgrade(async (tx) => {
      await runV20Migration(tx)
    })

    // v21: unify scheduling — drop priority + isHardDeadline, add scheduledDate,
    // seed listDefinitions (Today / Upcoming / Deadlines / Someday), and remove
    // retired 'high-priority' / priority-attribute list insets.
    this.version(21).stores({
      todos: '++id, projectId, canvasId, parentId, isCompleted, dueDate, sortOrder, statusId',
      listInsets: '++id, canvasId',
      listDefinitions: '++id, sortOrder',
    }).upgrade(async (tx) => {
      await runV21Migration(tx)
    })

    // v22: list-definitions builder DSL — add `pinnedToDashboard`, drop
    // `seededKey`. No index change (both fields are stored inline).
    this.version(22).stores({}).upgrade(async (tx) => {
      await runV22Migration(tx)
    })
  }
}

export const db = new Todo2Database()

export async function runV20Migration(tx: Transaction): Promise<void> {
  const statusesTable = tx.table<Status>('statuses')
  const todosTable = tx.table('todos')
  const listInsetsTable = tx.table<ListInset>('listInsets')
  const settingsTable = tx.table<SettingRow>('settings')

  const { assignedId, followupId } = await ensureSeededStatuses(statusesTable, settingsTable)

  await todosTable.toCollection().modify((todo: Record<string, unknown>) => {
    const existingStatusId = todo.statusId as number | undefined
    let nextStatusId: number | undefined = existingStatusId
    if (todo.isStarred) nextStatusId = followupId
    else if (todo.isAssigned) nextStatusId = assignedId
    if (nextStatusId !== existingStatusId) todo.statusId = nextStatusId
    delete todo.isStarred
    delete todo.isAssigned
  })

  const starredInsets = await listInsetsTable.filter(li => (li as any).preset === 'starred').toArray()
  if (starredInsets.length > 0) {
    await listInsetsTable.bulkDelete(starredInsets.map(li => li.id!))
    console.info(`v20 migration: removed ${starredInsets.length} starred list inset(s)`)
  }
}

export async function ensureSeededStatuses(
  statusesTable: Table<Status, number>,
  settingsTable: Table<SettingRow, string>,
): Promise<{ assignedId: number; followupId: number }> {
  const [assignedSetting, followupSetting] = await Promise.all([
    settingsTable.get('seededAssignedStatusId'),
    settingsTable.get('seededFollowupStatusId'),
  ])

  const seededAssignedId = assignedSetting ? Number(assignedSetting.value) : null
  const seededFollowupId = followupSetting ? Number(followupSetting.value) : null

  const existingAssigned = seededAssignedId != null
    ? await statusesTable.get(seededAssignedId)
    : undefined
  const existingFollowup = seededFollowupId != null
    ? await statusesTable.get(seededFollowupId)
    : undefined

  const all = await statusesTable.toArray()
  const maxSort = all.reduce((m, s) => Math.max(m, s.sortOrder), -1)
  let nextSort = maxSort

  let assignedId = existingAssigned?.id
  if (assignedId == null) {
    nextSort += 1
    assignedId = (await statusesTable.add({
      name: 'Assigned', color: '#537FE7', sortOrder: nextSort,
      icon: 'person', hideByDefault: true,
    } as Status)) as number
  }

  let followupId = existingFollowup?.id
  if (followupId == null) {
    nextSort += 1
    followupId = (await statusesTable.add({
      name: 'Follow-up', color: '#F5A623', sortOrder: nextSort,
      icon: 'message-bubble', hideByDefault: false,
    } as Status)) as number
  }

  await settingsTable.put({ key: 'seededAssignedStatusId', value: String(assignedId) })
  await settingsTable.put({ key: 'seededFollowupStatusId', value: String(followupId) })

  return { assignedId, followupId }
}

/**
 * v20→v21 per-todo translation. Mutates in place. Strips `priority` and
 * `isHardDeadline` keys regardless of branch.
 *
 * Q2 precedence (applied top-down):
 *   (a) recurrenceRule != null            → 'to-deadline' (keep dueDate; recurrence forces deadline)
 *   (b) isHardDeadline === true && dueDate→ 'to-deadline' (keep dueDate)
 *   (c) isHardDeadline === true && !dueDate → 'dropped-flag' (tautology; no date set)
 *   (d) dueDate && !isHardDeadline && no recurrence → 'to-scheduled' (move dueDate into scheduledDate)
 *   (e) else                              → 'noop' (no date change)
 *
 * Post-translation, both legacy keys are removed. Idempotent on a post-v21 row.
 */
export type TranslateV21Outcome = 'to-deadline' | 'to-scheduled' | 'dropped-flag' | 'noop'

export function translateTodoV20ToV21(todo: Record<string, unknown>): TranslateV21Outcome {
  // A v21 row has neither `priority` nor `isHardDeadline` keys — skip translation
  // so round-trip imports of already-migrated data don't re-interpret a bare
  // `dueDate` as a soft-due and move it into `scheduledDate`.
  const isPostV21 = !('priority' in todo) && !('isHardDeadline' in todo)
  if (isPostV21) return 'noop'

  const hasRec = todo.recurrenceRule != null
  const hard = todo.isHardDeadline === true
  const hasDue = todo.dueDate != null

  let outcome: TranslateV21Outcome = 'noop'
  if (hasRec && hasDue) {
    outcome = 'to-deadline'
  } else if (hard && hasDue) {
    outcome = 'to-deadline'
  } else if (hard && !hasDue) {
    outcome = 'dropped-flag'
  } else if (hasDue && !hard && !hasRec) {
    todo.scheduledDate = { kind: 'date', value: todo.dueDate as Date }
    delete todo.dueDate
    outcome = 'to-scheduled'
  }

  delete todo.priority
  delete todo.isHardDeadline
  return outcome
}

/**
 * v21 upgrade: rewrite todo rows into scheduled/deadline model, delete retired
 * priority list insets, seed listDefinitions. Per-row rules per plan Q2.
 */
export async function runV21Migration(tx: Transaction): Promise<void> {
  const todosTable = tx.table('todos')
  const listInsetsTable = tx.table<ListInset>('listInsets')
  const listDefinitionsTable = tx.table<ListDefinition>('listDefinitions')

  // 1) Seed listDefinitions (inserts the 4 defaults iff the table is empty).
  await ensureSeededListDefinitions(listDefinitionsTable)

  // 2) Per-row Q2 rules. See translateTodoV20ToV21 for the precedence table.
  let toDeadlineCount = 0
  let toScheduledCount = 0
  let droppedFlagCount = 0

  await todosTable.toCollection().modify((todo: Record<string, unknown>) => {
    const outcome = translateTodoV20ToV21(todo)
    if (outcome === 'to-scheduled') toScheduledCount++
    else if (outcome === 'to-deadline') toDeadlineCount++
    else if (outcome === 'dropped-flag') droppedFlagCount++
  })

  // 3) Delete list insets tied to retired priority concepts.
  const badPresetInsets = await listInsetsTable
    .filter(li => (li as unknown as Record<string, unknown>).preset === 'high-priority')
    .toArray()
  const badAttrInsets = await listInsetsTable
    .filter(li => {
      const af = (li as unknown as Record<string, unknown>).attributeFilter as Record<string, unknown> | undefined
      return af?.type === 'priority'
    })
    .toArray()
  const toDelete = [...badPresetInsets, ...badAttrInsets]
  if (toDelete.length > 0) {
    await listInsetsTable.bulkDelete(toDelete.map(li => li.id!))
    console.info(`v21 migration: removed ${toDelete.length} priority list inset(s)`)
  }

  console.info(
    `v21 migration: ${toScheduledCount} todos re-bucketed to scheduled, ` +
    `${toDeadlineCount} kept as deadline (recurrence or hard), ` +
    `${droppedFlagCount} hard-deadline flags dropped (no date)`,
  )
}

/**
 * Seeds the four default list definitions (Today / Upcoming / Deadlines /
 * Someday) iff the `listDefinitions` table is empty. Post-v22, the defaults
 * are just normal rows — if the user deletes them they stay deleted; if the
 * user renames them the rename persists.
 *
 * Used by `runV21Migration` (initial creation), `runV22Migration` (no-op when
 * v21 already seeded), and `restoreFromImportData` (backfill when an import
 * lacks a `listDefinitions` table).
 */
export async function ensureSeededListDefinitions(
  table: Table<ListDefinition, number>,
): Promise<void> {
  const count = await table.count()
  if (count > 0) return

  const seeds: Omit<ListDefinition, 'id'>[] = [
    {
      name: 'Today',
      sortOrder: 0,
      pinnedToDashboard: true,
      membership: { kind: 'today' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'none' },
    },
    {
      name: 'Upcoming',
      sortOrder: 1,
      pinnedToDashboard: true,
      membership: { kind: 'upcoming' },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'relative-effective' },
    },
    {
      name: 'Deadlines',
      sortOrder: 2,
      pinnedToDashboard: true,
      membership: { kind: 'deadlines' },
      sort: { kind: 'deadline-asc' },
      grouping: { kind: 'relative-deadline' },
    },
    {
      name: 'Someday',
      sortOrder: 3,
      pinnedToDashboard: true,
      membership: { kind: 'someday' },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    },
  ]

  for (const seed of seeds) {
    await table.add(seed as ListDefinition)
  }
}

/**
 * v22 upgrade: backfill `pinnedToDashboard = true` on every existing list
 * definition (the four v21 seeds are the only possible rows) and strip the
 * retired `seededKey` field. No-op if the table is empty (v21 migration
 * already seeded four rows).
 */
export async function runV22Migration(tx: Transaction): Promise<void> {
  const listDefsTable = tx.table('listDefinitions')
  await listDefsTable.toCollection().modify((def: Record<string, unknown>) => {
    if (def.pinnedToDashboard === undefined) def.pinnedToDashboard = true
    delete def.seededKey
  })
}

/** All data tables (excludes backups). Used for export, import, and file-storage sync. */
export const ALL_DATA_TABLES = [db.todos, db.projects, db.canvases, db.listInsets, db.people, db.settings, db.tags, db.todoTags, db.todoPeople, db.todoOrgs, db.personOrgs, db.orgs, db.savedViews, db.stickyNotes, db.taskboardEntries, db.statuses, db.listDefinitions] as const
