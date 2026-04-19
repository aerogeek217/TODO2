import Dexie, { type Table, type Transaction } from 'dexie'
import type { TodoItem, Project, Canvas, Person, Tag, TodoTag, TodoPerson, TodoOrg, PersonOrg, ListInset, Org, Backup, SavedView, TaskboardEntry, Status, Note, FloatingCalendar, FloatingNote } from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { TodoPredicate, DateAnchor } from '../models/filter-predicate'
import { HORIZON_KEYS, type HorizonKey } from '../services/horizons'

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
  taskboardEntries!: Table<TaskboardEntry, number>
  statuses!: Table<Status, number>
  listDefinitions!: Table<ListDefinition, number>
  notes!: Table<Note, number>
  floatingCalendars!: Table<FloatingCalendar, number>
  floatingNotes!: Table<FloatingNote, number>

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

    // v23: canvas list-inset unification — drop `preset` / `attributeFilter` /
    // `name` on `ListInset`; each row gains `listDefinitionId` referencing a
    // freshly-created (unpinned) `ListDefinition`.
    this.version(23).stores({}).upgrade(async (tx) => {
      await runV23Migration(tx)
    })

    // v24: horizon-ribbon reseed — retire the today/upcoming/deadlines/someday
    // ListMembership kinds; clear listDefinitions and reseed with 5 horizon
    // custom-predicate defs (ThisWeek / NextWeek / RestOfMonth / Later /
    // Someday); write the `horizonSlots` setting mapping each horizon to the
    // new def id. No users on this branch at the time of the migration, so
    // clearing is acceptable.
    this.version(24).stores({}).upgrade(async (tx) => {
      await runV24Migration(tx)
    })

    // v25: add standalone `notes` table for the dashboard Markdown inbox
    // (Phase 3 of the dashboard + canvas master plan). Shape matches multi-note
    // semantics so a future multi-row UI doesn't require another schema bump.
    this.version(25).stores({
      notes: '++id, modifiedAt',
    })

    // v26: sticky-notes → notes merge. Extend `notes` with optional canvas
    // placement fields (canvasId, x, y, width, height, color); migrate every
    // `stickyNotes` row into a matching `notes` row (title prepended as H1);
    // drop the `stickyNotes` table. A note with canvasId != null is a
    // canvas-pinned floating note; canvasId == null backs the dashboard
    // Notes tile and rail slot.
    this.version(26).stores({
      notes: '++id, modifiedAt, canvasId',
      stickyNotes: null,
    }).upgrade(async (tx) => {
      await runV26Migration(tx)
    })

    // v27: add `floatingCalendars` table — backing store for rail calendar
    // slots popped out to the canvas (P6 of canvas-rails-polish). No data
    // migration; the table starts empty.
    this.version(27).stores({
      floatingCalendars: '++id, canvasId',
    })

    // v28: floating-notes refactor. Canvas floating notes are now placement-
    // only widgets that render the single global note (same pattern as
    // FloatingCalendar / ListInset). Every existing `notes` row with
    // canvasId != null becomes a `floatingNotes` row (dropping content +
    // color — only placement survives). The `notes` table retains only
    // global rows (canvasId == null).
    this.version(28).stores({
      floatingNotes: '++id, canvasId',
    }).upgrade(async (tx) => {
      await runV28Migration(tx)
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

/** Base predicate for horizon seeds — inherits standard completed/hidden gates. */
function basePredicate(): TodoPredicate {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
  }
}

function relAnchor(token: Extract<DateAnchor, { kind: 'relative' }>['token']): DateAnchor {
  return { kind: 'relative', token }
}

/**
 * Seed configuration for the 5 horizon list-definitions. Rendered on the
 * dashboard ribbon; each maps to a slot in `settings.horizonSlots`.
 */
interface HorizonSeed {
  horizonKey: HorizonKey
  def: Omit<ListDefinition, 'id'>
}

function horizonSeeds(): HorizonSeed[] {
  return [
    {
      horizonKey: 'thisweek',
      def: {
        name: 'This week',
        sortOrder: 0,
        pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('start-of-week'),
            dateRangeEnd: relAnchor('end-of-week'),
          },
        },
        sort: { kind: 'effective-date-asc' },
        grouping: { kind: 'none' },
      },
    },
    {
      horizonKey: 'nextweek',
      def: {
        name: 'Next week',
        sortOrder: 1,
        pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('start-of-next-week'),
            dateRangeEnd: relAnchor('end-of-next-week'),
          },
        },
        sort: { kind: 'effective-date-asc' },
        grouping: { kind: 'none' },
      },
    },
    {
      horizonKey: 'thismonth',
      def: {
        name: 'Rest of month',
        sortOrder: 2,
        pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('tomorrow'),
            dateRangeEnd: relAnchor('end-of-month'),
          },
        },
        sort: { kind: 'effective-date-asc' },
        grouping: { kind: 'none' },
      },
    },
    {
      horizonKey: 'later',
      def: {
        name: 'Later',
        sortOrder: 3,
        pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('start-of-next-month'),
            dateRangeEnd: relAnchor('end-of-month-plus-3'),
          },
        },
        sort: { kind: 'effective-date-asc' },
        grouping: { kind: 'relative-effective' },
      },
    },
    {
      horizonKey: 'someday',
      def: {
        name: 'Someday',
        sortOrder: 4,
        pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            hasScheduled: false,
            hasDeadline: false,
          },
        },
        sort: { kind: 'sort-order' },
        grouping: { kind: 'none' },
      },
    },
  ]
}

/**
 * Seeds the 5 horizon list definitions iff the `listDefinitions` table is
 * empty. Returns a `HorizonKey → new id` map when seeding happens; returns
 * an empty object when the table is non-empty (caller should load existing
 * `horizonSlots` from settings).
 *
 * Post-v24, the seeds are just normal rows — if the user deletes them they
 * stay deleted; if the user renames them the rename persists.
 *
 * Used by `runV24Migration` (initial creation after clear), `runV21Migration`
 * and `runV22Migration` (no-op now that v24 always reseeds), and
 * `restoreFromImportData` (after clear).
 */
export async function ensureSeededListDefinitions(
  table: Table<ListDefinition, number>,
): Promise<Partial<Record<HorizonKey, number>>> {
  const count = await table.count()
  if (count > 0) return {}

  const slots: Partial<Record<HorizonKey, number>> = {}
  for (const { horizonKey, def } of horizonSeeds()) {
    const id = (await table.add(def as ListDefinition)) as number
    slots[horizonKey] = id
  }
  return slots
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

/** Default empty predicate (matches all tasks aside from the standard gates). */
function emptyPredicateSeed(): Record<string, unknown> {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    tagIds: null,
    orgIds: null,
    orgFilterMode: 'include-people',
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
  }
}

/**
 * Builds a synthetic `ListDefinition` row (no id / sortOrder assigned) from a
 * pre-v23 list-inset row. Preset `due-this-week` becomes a custom predicate
 * pinned to an `effectiveDate <= today+7d` range at migration time (fixed-date
 * compromise per plan D10 — the rolling semantics are lost). Attribute filters
 * become a custom predicate scoped to the referenced person/tag/org.
 *
 * Returns `null` for rows that don't match any known legacy shape — callers
 * treat these as corrupt and drop the inset.
 */
export function buildListDefFromLegacyInset(
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Omit<ListDefinition, 'id' | 'sortOrder'> | null {
  const insetName = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : null
  const preset = raw.preset
  const attr = raw.attributeFilter as Record<string, unknown> | undefined

  if (preset === 'due-this-week') {
    const end = new Date(now)
    end.setDate(end.getDate() + 7)
    const predicate = emptyPredicateSeed()
    predicate.dateField = 'date'
    predicate.dateRangeEnd = { kind: 'fixed', iso: end.toISOString() }
    return {
      name: insetName ?? 'Due this week',
      pinnedToDashboard: false,
      membership: {
        kind: 'custom',
        predicate: predicate as unknown as import('../models').TodoPredicate,
      },
      sort: { kind: 'effective-date-asc' },
      grouping: { kind: 'none' },
    }
  }

  if (attr && typeof attr.type === 'string') {
    const predicate = emptyPredicateSeed()
    let derivedName: string
    switch (attr.type) {
      case 'person': {
        const id = attr.personId as number | undefined
        if (typeof id !== 'number') return null
        predicate.personIds = [id]
        derivedName = `Tasks assigned to ${attr.personName ?? 'person'}`
        break
      }
      case 'tag': {
        const id = attr.tagId as number | undefined
        if (typeof id !== 'number') return null
        predicate.tagIds = [id]
        derivedName = `Tasks tagged ${attr.tagName ?? 'tag'}`
        break
      }
      case 'org': {
        const id = attr.orgId as number | undefined
        if (typeof id !== 'number') return null
        predicate.orgIds = [id]
        derivedName = `Tasks in ${attr.orgName ?? 'org'}`
        break
      }
      default:
        return null
    }
    return {
      name: insetName ?? derivedName,
      pinnedToDashboard: false,
      membership: {
        kind: 'custom',
        predicate: predicate as unknown as import('../models').TodoPredicate,
      },
      sort: { kind: 'sort-order' },
      grouping: { kind: 'none' },
    }
  }

  return null
}

/**
 * v23 upgrade: for every existing list-inset row, synthesize a matching
 * (unpinned) `ListDefinition` and rewrite the inset to reference it by id.
 * The legacy `preset` / `attributeFilter` / `name` fields are stripped.
 * Rows with no recognizable legacy shape are deleted.
 */
export async function runV23Migration(tx: Transaction): Promise<void> {
  const listInsetsTable = tx.table('listInsets')
  const listDefsTable = tx.table<ListDefinition>('listDefinitions')

  const existingDefs = await listDefsTable.toArray()
  let nextSortOrder = existingDefs.reduce((m, d) => Math.max(m, d.sortOrder), -1) + 1

  const rows = await listInsetsTable.toArray() as unknown as Record<string, unknown>[]
  const toDelete: number[] = []
  const now = new Date()

  for (const row of rows) {
    // Already migrated (has listDefinitionId, no legacy fields) — no-op.
    if (row.listDefinitionId != null && row.preset == null && row.attributeFilter == null) {
      continue
    }

    const def = buildListDefFromLegacyInset(row, now)
    if (!def) {
      if (row.id != null) toDelete.push(row.id as number)
      continue
    }

    const newId = await listDefsTable.add({
      ...def,
      sortOrder: nextSortOrder++,
    } as ListDefinition) as number

    await listInsetsTable
      .where(':id').equals(row.id as number)
      .modify((inset: Record<string, unknown>) => {
        inset.listDefinitionId = newId
        delete inset.preset
        delete inset.attributeFilter
        delete inset.name
      })
  }

  if (toDelete.length > 0) {
    await listInsetsTable.bulkDelete(toDelete)
    console.info(`v23 migration: dropped ${toDelete.length} corrupt list inset(s)`)
  }
}

/**
 * v24 upgrade: retire the 4 legacy horizon kinds; clear `listDefinitions` and
 * reseed with 5 horizon custom-predicate defs; persist the resulting
 * `HorizonKey → id` mapping in the `horizonSlots` setting. Safe because the
 * feature branch has no production users.
 */
export async function runV24Migration(tx: Transaction): Promise<void> {
  const listDefsTable = tx.table<ListDefinition>('listDefinitions')
  const settingsTable = tx.table<SettingRow>('settings')

  await listDefsTable.clear()
  const slots = await ensureSeededListDefinitions(listDefsTable)
  await persistHorizonSlots(settingsTable, slots)
}

/**
 * Writes `settings.horizonSlots` as JSON (one row). `null` values allowed so
 * the caller can explicitly un-map a slot to surface the "Configure horizon…"
 * placeholder in the ribbon.
 */
export async function persistHorizonSlots(
  settingsTable: Table<SettingRow, string>,
  slots: Partial<Record<HorizonKey, number | null>>,
): Promise<void> {
  await settingsTable.put({ key: 'horizonSlots', value: JSON.stringify(slots) })
}

/**
 * Parse `settings.horizonSlots`. Returns `{}` when absent / invalid. Invalid
 * slot keys are silently dropped (never throw — a bad settings row should not
 * break dashboard rendering).
 */
export function parseHorizonSlots(value: string | undefined | null): Partial<Record<HorizonKey, number>> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Partial<Record<HorizonKey, number>> = {}
    for (const key of HORIZON_KEYS) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    }
    return out
  } catch {
    return {}
  }
}

/** All data tables (excludes backups). Used for export, import, and file-storage sync. */
export const ALL_DATA_TABLES = [db.todos, db.projects, db.canvases, db.listInsets, db.people, db.settings, db.tags, db.todoTags, db.todoPeople, db.todoOrgs, db.personOrgs, db.orgs, db.savedViews, db.taskboardEntries, db.statuses, db.listDefinitions, db.notes, db.floatingCalendars, db.floatingNotes] as const

/**
 * Translate a legacy note row carrying canvasId + placement fields (post-v26
 * shape) into a placement-only `floatingNotes` row. Content and color are
 * dropped — v28 collapses all canvas floating notes into views of the single
 * global note, so per-row content no longer exists.
 *
 * Pure function — shared between `runV28Migration` and restore-time handling
 * of pre-v28 backups.
 */
export function translateNoteToFloatingNote(note: Record<string, unknown>): Omit<FloatingNote, 'id'> | null {
  if (typeof note.canvasId !== 'number') return null
  return {
    canvasId: note.canvasId,
    x: typeof note.x === 'number' ? note.x : 0,
    y: typeof note.y === 'number' ? note.y : 0,
    width: typeof note.width === 'number' ? note.width : 240,
    height: typeof note.height === 'number' ? note.height : 200,
  }
}

/**
 * v28 upgrade: split canvas floating notes out of the `notes` table into a
 * dedicated `floatingNotes` placement table. Existing canvas-scoped rows get
 * moved (content + color dropped); global rows (canvasId == null) are left
 * alone. Idempotent — a re-run with no canvas-scoped rows is a no-op.
 */
export async function runV28Migration(tx: Transaction): Promise<void> {
  const notesTable = tx.table('notes')
  const floatingNotesTable = tx.table<FloatingNote>('floatingNotes')
  const canvasScoped = await notesTable
    .filter((n: Record<string, unknown>) => typeof n.canvasId === 'number')
    .toArray() as Record<string, unknown>[]
  if (canvasScoped.length === 0) return

  const placements: Omit<FloatingNote, 'id'>[] = []
  const toDelete: number[] = []
  for (const row of canvasScoped) {
    const placement = translateNoteToFloatingNote(row)
    if (placement) placements.push(placement)
    if (typeof row.id === 'number') toDelete.push(row.id)
  }
  if (placements.length > 0) await floatingNotesTable.bulkAdd(placements as FloatingNote[])
  if (toDelete.length > 0) await notesTable.bulkDelete(toDelete)
  console.info(`v28 migration: moved ${placements.length} canvas floating note(s) to floatingNotes (content dropped)`)
}

/**
 * Translate a legacy sticky-note row (title, text, canvasId, x/y/w/h, color,
 * createdAt, modifiedAt) into the matching `notes` row. Title, when present,
 * is prepended as an H1 so it's visible in the Markdown editor.
 *
 * Pure function — shared between `runV26Migration` and restore-time
 * translation of legacy backups.
 */
/**
 * Shape of a sticky-note row after normalization: content + placement
 * fields. Post-v28 the placement fields live in `floatingNotes`, so callers
 * that write into the `notes` table should use the content-only subset; the
 * placement fields are carried along for the subsequent sticky → floating
 * note translation.
 */
export type LegacyStickyNote = Omit<Note, 'id'> & {
  canvasId?: number
  x?: number
  y?: number
  width?: number
  height?: number
  color?: string
}

export function translateStickyToNote(sticky: Record<string, unknown>): LegacyStickyNote {
  const title = typeof sticky.title === 'string' ? sticky.title.trim() : ''
  const text = typeof sticky.text === 'string' ? sticky.text : ''
  const content = title
    ? text ? `# ${title}\n\n${text}` : `# ${title}`
    : text

  const note: LegacyStickyNote = {
    content,
    createdAt: (sticky.createdAt as Date) ?? new Date(),
    modifiedAt: (sticky.modifiedAt as Date) ?? new Date(),
  }
  if (typeof sticky.canvasId === 'number') note.canvasId = sticky.canvasId
  if (typeof sticky.x === 'number') note.x = sticky.x
  if (typeof sticky.y === 'number') note.y = sticky.y
  if (typeof sticky.width === 'number') note.width = sticky.width
  if (typeof sticky.height === 'number') note.height = sticky.height
  if (typeof sticky.color === 'string') note.color = sticky.color
  return note
}

/**
 * v26 upgrade: move every `stickyNotes` row into a matching `notes` row via
 * `translateStickyToNote`, then drop the `stickyNotes` store. Safe even if
 * the store already went through the deletion pass — Dexie just skips the
 * removed store.
 */
export async function runV26Migration(tx: Transaction): Promise<void> {
  // When migrating from ≤v25 the `stickyNotes` table still exists at this
  // point (Dexie removes it *after* the upgrade callback runs), so we can
  // safely read from it. Wrapped in try/catch for the rare case where a db
  // with no stickyNotes table reaches v26.
  let rows: Record<string, unknown>[] = []
  try {
    rows = await tx.table('stickyNotes').toArray() as Record<string, unknown>[]
  } catch {
    return
  }
  if (rows.length === 0) return

  const notesTable = tx.table<Note>('notes')
  const translated = rows.map(translateStickyToNote)
  await notesTable.bulkAdd(translated as Note[])
  console.info(`v26 migration: moved ${translated.length} sticky note(s) into notes table`)
}
