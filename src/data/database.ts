import Dexie, { type Table, type Transaction } from 'dexie'
import type { TodoItem, Project, Canvas, Person, TodoPerson, TodoOrg, PersonOrg, ListInset, Org, Backup, SavedView, Taskboard, TaskboardEntry, Status, Note, FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingHorizons, Tag, TodoTag } from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { TodoPredicate, DateAnchor } from '../models/filter-predicate'
import type { HorizonKey } from '../services/horizons'
import { DEFAULT_ENTITY_COLOR } from '../constants'

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
  todoPeople!: Table<TodoPerson, number>
  listInsets!: Table<ListInset, number>
  orgs!: Table<Org, number>
  todoOrgs!: Table<TodoOrg, number>
  personOrgs!: Table<PersonOrg, number>
  backups!: Table<Backup, number>
  savedViews!: Table<SavedView, number>
  taskboards!: Table<Taskboard, number>
  statuses!: Table<Status, number>
  listDefinitions!: Table<ListDefinition, number>
  notes!: Table<Note, number>
  floatingCalendars!: Table<FloatingCalendar, number>
  floatingNotes!: Table<FloatingNote, number>
  floatingTaskboards!: Table<FloatingTaskboard, number>
  floatingHorizons!: Table<FloatingHorizons, number>
  tags!: Table<Tag, number>
  todoTags!: Table<TodoTag, number>

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

    // v29: remove the tags feature entirely. For each todo with assigned tags,
    // append " #tagname" to its title (preserving discoverability via the
    // text-search predicate). Strip `tagIds` from any custom predicate stored
    // inside `listDefinitions` and `savedViews`. Drop the `tags` and
    // `todoTags` tables.
    this.version(29).stores({
      tags: null,
      todoTags: null,
    }).upgrade(async (tx) => {
      await runV29Migration(tx)
    })

    // v30: taskboard-as-instance. Taskboards are now reusable records (name +
    // inline entries list) keyed by id; rail slots and floating canvas widgets
    // reference a taskboard by id. The old `taskboardEntries` join table is
    // collapsed into a single seeded "Default" taskboard. Adds a
    // `floatingTaskboards` placement table (parallels floatingNotes /
    // floatingCalendars) and tags any pre-existing rail taskboard slot with
    // the seeded id.
    this.version(30).stores({
      taskboardEntries: null,
      taskboards: '++id',
      floatingTaskboards: '++id, canvasId, taskboardId',
    }).upgrade(async (tx) => {
      await runV30Migration(tx)
    })

    // v31: drop `color` from `people`. Person color is now derived from the
    // person's first assigned org (`personOrgs` join + `orgs.color`). Strips
    // the key from every row; no data loss beyond the color itself. Idempotent
    // on post-v31 rows (no-op when the key is already absent).
    this.version(31).stores({}).upgrade(async (tx) => {
      await runV31Migration(tx)
    })

    // v32: add optional `orientation` + `weekOffset` to calendar widgets
    // (rail `Slot` rows stored inside `settings.canvasRails`, plus
    // `floatingCalendars` rows). Both fields are stored inline and default to
    // 'vertical' / 0 at read time; existing rows need no rewriting.
    this.version(32).stores({})

    // v33: taskboard-as-singleton (widget-taskboard-dnd P1). Coalesce all
    // `taskboards` rows into one (union entries, dedupe by `todoId`, keep
    // first-seen sort order); drop `name` from the surviving row; strip
    // `taskboardId` from every `floatingTaskboards` row and from every
    // tab/slot inside `settings.canvasRails`; delete
    // `settings.defaultTaskboardId`. Drop the `taskboardId` index on
    // `floatingTaskboards`.
    this.version(33)
      .stores({
        floatingTaskboards: '++id, canvasId',
      })
      .upgrade(async (tx) => {
        await runV33Migration(tx)
      })

    // v34: flatten — remove parent-child hierarchy. Restate the todos schema
    // string without `parentId` so Dexie drops the index; walk every row and
    // delete the `parentId` key.
    this.version(34)
      .stores({
        todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId',
      })
      .upgrade(async (tx) => {
        await runV34Migration(tx)
      })

    // v35: tags re-introduced as an inline `tags?: string[]` field on
    // `TodoItem`. No index (search hits the hot path), so the schema string is
    // unchanged. Version bump + empty store object kept for auditability —
    // existing rows need no rewriting (the field is optional and omitted when
    // empty).
    this.version(35).stores({})

    // v36: tags v2 — recreate the normalized `tags` + `todoTags` tables that
    // v29 dropped. Seed the registry from existing inline `todo.tags` slugs
    // (case-folded, first-seen canonical casing, `DEFAULT_ENTITY_COLOR`);
    // emit `todoTags` join rows per todo; translate stored predicate/saved-
    // view `tags: string[]` clauses to `tags: number[]` via the same slug→id
    // lookup. Unknown names on stored predicates are dropped with a single
    // console warning. The inline `todo.tags` field survives transiently
    // through Phase 8; v37 removes it.
    this.version(36)
      .stores({
        tags: '++id, name',
        todoTags: '++id, todoId, tagId',
      })
      .upgrade(async (tx) => {
        await runV36Migration(tx)
      })

    // v37: tags v2 cutover — delete the transient inline `tags` key from every
    // todo row. Schema string unchanged (the field was never indexed). The
    // registry + `todoTags` joins seeded in v36 are now the sole source of
    // truth for tag data.
    this.version(37)
      .stores({})
      .upgrade(async (tx) => {
        await runV37Migration(tx)
      })

    // v38: add `floatingHorizons` table — backing store for the horizon widget
    // popped out to canvas (Phase 5 of features-batch-2026-04). No data
    // migration; the table starts empty. Mirrors the v27 floatingCalendars
    // bump + v33 floatingTaskboards shape (placement-only; ribbon state lives
    // in settings).
    this.version(38).stores({
      floatingHorizons: '++id, canvasId',
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
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
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
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
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
        // v29 retired the tags feature. Legacy tag-attribute insets become
        // a text-search predicate scoped to `#tagname` so they keep
        // surfacing the same todos via the post-v29 inline tag suffixes.
        const name = typeof attr.tagName === 'string' ? attr.tagName.trim() : ''
        if (!name) return null
        predicate.searchText = `#${name}`
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

/** All data tables (excludes backups). Used for export, import, and file-storage sync. */
export const ALL_DATA_TABLES = [db.todos, db.projects, db.canvases, db.listInsets, db.people, db.settings, db.todoPeople, db.todoOrgs, db.personOrgs, db.orgs, db.savedViews, db.taskboards, db.statuses, db.listDefinitions, db.notes, db.floatingCalendars, db.floatingNotes, db.floatingTaskboards, db.floatingHorizons, db.tags, db.todoTags] as const

/**
 * Append `" #tagname"` for every assigned tag to each todo's title. Mutates
 * the `todos` array (or, when `mutate` returns void, calls it per row). Pure
 * over its inputs — shared between `runV29Migration` (in-place migration)
 * and `restoreFromImportData` (legacy JSON import).
 *
 * Tag names are NOT sanitized — text search is plain substring, so spaces in
 * a tag name still resolve. The `#` marker stays meaningful so a search for
 * `#urgent` keeps matching tag-derived text. Empty / whitespace-only tag
 * names are skipped.
 */
export function appendTagNamesToTitle(
  title: string,
  tagNames: string[],
): string {
  const cleaned = tagNames.map((n) => n.trim()).filter((n) => n.length > 0)
  if (cleaned.length === 0) return title
  const suffix = cleaned.map((n) => `#${n}`).join(' ')
  return title.length > 0 ? `${title} ${suffix}` : suffix
}

/**
 * Build a `todoId → tagNames[]` map from the join + tag arrays. Pure helper
 * shared between in-place migration and import-time tag flattening.
 */
export function buildTagNamesByTodo(
  todoTags: { todoId: number; tagId: number }[],
  tags: { id?: number; name: string }[],
): Map<number, string[]> {
  const tagNameById = new Map<number, string>()
  for (const t of tags) {
    if (typeof t.id === 'number') tagNameById.set(t.id, t.name)
  }
  const out = new Map<number, string[]>()
  for (const j of todoTags) {
    const name = tagNameById.get(j.tagId)
    if (!name) continue
    const list = out.get(j.todoId) ?? []
    list.push(name)
    out.set(j.todoId, list)
  }
  return out
}

/**
 * v29 upgrade: bake tag assignments into todo titles as `#tagname` suffixes,
 * strip `tagIds` from saved custom predicates, drop the tag tables.
 *
 * Read order matters: tags + todoTags are read inside the upgrade callback;
 * Dexie removes the stores AFTER the callback returns so the reads are safe.
 */
export async function runV29Migration(tx: Transaction): Promise<void> {
  let tagsRows: { id?: number; name: string }[] = []
  let joinRows: { todoId: number; tagId: number }[] = []
  try {
    tagsRows = await tx.table('tags').toArray() as { id?: number; name: string }[]
  } catch { /* table already gone */ }
  try {
    joinRows = await tx.table('todoTags').toArray() as { todoId: number; tagId: number }[]
  } catch { /* table already gone */ }

  const namesByTodo = buildTagNamesByTodo(joinRows, tagsRows)
  let mutated = 0
  if (namesByTodo.size > 0) {
    await tx.table('todos').toCollection().modify((todo: Record<string, unknown>) => {
      const id = todo.id as number | undefined
      if (id == null) return
      const names = namesByTodo.get(id)
      if (!names || names.length === 0) return
      const before = typeof todo.title === 'string' ? todo.title : ''
      const after = appendTagNamesToTitle(before, names)
      if (after !== before) {
        todo.title = after
        mutated++
      }
    })
  }

  // Strip tagIds from any custom predicate stored on a list definition.
  await tx.table('listDefinitions').toCollection().modify((def: Record<string, unknown>) => {
    const m = def.membership as Record<string, unknown> | undefined
    if (!m || m.kind !== 'custom') return
    const p = m.predicate as Record<string, unknown> | undefined
    if (!p) return
    if ('tagIds' in p) delete p.tagIds
  })

  // Strip tagIds from any persisted saved-view filter set.
  await tx.table('savedViews').toCollection().modify((sv: Record<string, unknown>) => {
    const f = sv.filters as Record<string, unknown> | undefined
    if (!f) return
    if ('tagIds' in f) delete f.tagIds
    // Translate sortBy === 'tag' into a benign default so the view still loads.
    if (sv.sortBy === 'tag') sv.sortBy = 'date'
    if (sv.groupBy === 'tag') sv.groupBy = 'none'
  })

  console.info(`v29 migration: baked tag names into ${mutated} todo title(s); dropped tags + todoTags tables`)
}

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

/**
 * Seed the single "Default" taskboard iff `taskboards` is empty. `entries`
 * carries any pre-existing queue (from the pre-v30 `taskboardEntries` join).
 * Persists the resulting id under `settings.defaultTaskboardId` so the runtime
 * + rail-slot migration can find it.
 *
 * Shared between `runV30Migration` (in-place migration) and
 * `restoreFromImportData` (legacy JSON restore path).
 */
export async function ensureSeededDefaultTaskboard(
  taskboardsTable: Table<Taskboard, number>,
  settingsTable: Table<SettingRow, string>,
  entries: TaskboardEntry[] = [],
): Promise<number> {
  const existing = await settingsTable.get('defaultTaskboardId')
  if (existing) {
    const id = Number(existing.value)
    const row = await taskboardsTable.get(id)
    if (row) return id
  }
  const count = await taskboardsTable.count()
  if (count > 0) {
    const first = await taskboardsTable.orderBy('id').first()
    if (first?.id != null) {
      await settingsTable.put({ key: 'defaultTaskboardId', value: String(first.id) })
      return first.id
    }
  }
  const now = new Date()
  // Pre-v33 schema stored a `name` on each taskboard row. The v33 migration
  // strips it — but here we still write it so a v30 migration executed on an
  // old DB stays byte-identical to what it was before v33 landed.
  const id = (await taskboardsTable.add({
    name: 'Default',
    entries: sortEntries(entries),
    createdAt: now,
    updatedAt: now,
  } as unknown as Taskboard)) as number
  await settingsTable.put({ key: 'defaultTaskboardId', value: String(id) })
  return id
}

function sortEntries(entries: TaskboardEntry[]): TaskboardEntry[] {
  return [...entries].sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Rewrite `settings.canvasRails`: any slot with `kind === 'taskboard'` gains
 * `taskboardId: <defaultId>`. Pure over input — returns the updated JSON string
 * (or the original value when no change is needed). Invalid JSON is left as-is.
 */
export function tagRailsTaskboardSlots(railsJson: string | undefined, defaultTaskboardId: number): string | undefined {
  if (!railsJson) return railsJson
  let parsed: unknown
  try { parsed = JSON.parse(railsJson) } catch { return railsJson }
  if (!parsed || typeof parsed !== 'object') return railsJson
  let touched = false
  const sides = ['left', 'right', 'top', 'bottom'] as const
  for (const side of sides) {
    const rail = (parsed as Record<string, unknown>)[side]
    if (!rail || typeof rail !== 'object') continue
    const slots = (rail as Record<string, unknown>).slots
    if (!Array.isArray(slots)) continue
    for (const s of slots) {
      if (!s || typeof s !== 'object') continue
      const slot = s as Record<string, unknown>
      // New shape: walk tabs[] for taskboard types missing a board id.
      if (Array.isArray(slot.tabs)) {
        for (const raw of slot.tabs) {
          if (!raw || typeof raw !== 'object') continue
          const tab = raw as Record<string, unknown>
          if (tab.type === 'taskboard' && tab.taskboardId == null) {
            tab.taskboardId = defaultTaskboardId
            touched = true
          }
        }
        continue
      }
      // Legacy shape fallback.
      if (slot.kind === 'taskboard' && slot.taskboardId == null) {
        slot.taskboardId = defaultTaskboardId
        touched = true
      }
    }
  }
  return touched ? JSON.stringify(parsed) : railsJson
}

/**
 * v30 upgrade: collapse `taskboardEntries` rows into a single "Default"
 * `Taskboard`, persist the new id under `settings.defaultTaskboardId`, and tag
 * any existing rail taskboard slot with that id. Safe when run on a DB whose
 * `taskboardEntries` table is already gone (first load after a fresh
 * install): the default taskboard is still seeded with an empty entries list.
 */
export async function runV30Migration(tx: Transaction): Promise<void> {
  const taskboardsTable = tx.table<Taskboard>('taskboards')
  const settingsTable = tx.table<SettingRow>('settings')

  let legacyEntries: TaskboardEntry[] = []
  try {
    const rows = await tx.table('taskboardEntries').toArray() as Array<{ todoId: number; sortOrder: number }>
    legacyEntries = rows.map((r) => ({ todoId: r.todoId, sortOrder: r.sortOrder }))
  } catch { /* table already gone */ }

  const defaultId = await ensureSeededDefaultTaskboard(taskboardsTable, settingsTable, legacyEntries)

  const railsSetting = await settingsTable.get('canvasRails')
  if (railsSetting) {
    const next = tagRailsTaskboardSlots(railsSetting.value, defaultId)
    if (next !== railsSetting.value) {
      await settingsTable.put({ key: 'canvasRails', value: next! })
    }
  }

  console.info(`v30 migration: seeded Default taskboard (id=${defaultId}) with ${legacyEntries.length} entries`)
}

/**
 * Collapse a multi-row `taskboards` table into a single row (union entries,
 * dedupe by `todoId`, keep first-seen sort order; drop `name`). Pure over its
 * input so it can be shared between the v33 migration and restore.
 *
 * Returns the new row (unsaved — caller writes it to the table) plus the list
 * of legacy ids to delete.
 */
export function coalesceTaskboardRows(
  rows: Array<{ id?: number; entries: TaskboardEntry[]; createdAt?: Date; updatedAt?: Date }>,
): { survivor: Omit<Taskboard, 'id'> & { id?: number }; legacyIds: number[] } {
  if (rows.length === 0) {
    const now = new Date()
    return { survivor: { entries: [], createdAt: now, updatedAt: now }, legacyIds: [] }
  }
  const sorted = [...rows].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
  const survivor = sorted[0]
  const seen = new Set<number>()
  const entries: TaskboardEntry[] = []
  for (const row of sorted) {
    for (const e of row.entries) {
      if (seen.has(e.todoId)) continue
      seen.add(e.todoId)
      entries.push({ todoId: e.todoId, sortOrder: e.sortOrder })
    }
  }
  const now = new Date()
  return {
    survivor: {
      id: survivor.id,
      entries,
      createdAt: survivor.createdAt ?? now,
      updatedAt: now,
    },
    legacyIds: sorted.slice(1).map((r) => r.id!).filter((id) => id != null),
  }
}

/**
 * Strip `taskboardId` from every tab/slot inside a serialized `canvasRails`
 * JSON blob. Pure; returns the updated JSON string (or the input when no
 * change is needed). Invalid JSON is returned unchanged.
 */
export function stripRailsTaskboardIds(railsJson: string | undefined): string | undefined {
  if (!railsJson) return railsJson
  let parsed: unknown
  try { parsed = JSON.parse(railsJson) } catch { return railsJson }
  if (!parsed || typeof parsed !== 'object') return railsJson
  let touched = false
  const sides = ['left', 'right', 'top', 'bottom'] as const
  for (const side of sides) {
    const rail = (parsed as Record<string, unknown>)[side]
    if (!rail || typeof rail !== 'object') continue
    const slots = (rail as Record<string, unknown>).slots
    if (!Array.isArray(slots)) continue
    for (const s of slots) {
      if (!s || typeof s !== 'object') continue
      const slot = s as Record<string, unknown>
      if ('taskboardId' in slot) { delete slot.taskboardId; touched = true }
      if (Array.isArray(slot.tabs)) {
        for (const raw of slot.tabs) {
          if (!raw || typeof raw !== 'object') continue
          const tab = raw as Record<string, unknown>
          if ('taskboardId' in tab) { delete tab.taskboardId; touched = true }
        }
      }
    }
  }
  return touched ? JSON.stringify(parsed) : railsJson
}

/**
 * v33 upgrade: collapse taskboard plumbing to a singleton. Coalesces all
 * `taskboards` rows into one (union entries, dedupe by `todoId`; drop
 * `name`), strips `taskboardId` from every `floatingTaskboards` row and from
 * every tab/slot in `settings.canvasRails`, and removes
 * `settings.defaultTaskboardId`.
 */
export async function runV33Migration(tx: Transaction): Promise<void> {
  const taskboardsTable = tx.table<Taskboard>('taskboards')
  const floatingTable = tx.table('floatingTaskboards')
  const settingsTable = tx.table<SettingRow>('settings')

  const rows = await taskboardsTable.toArray()
  const { survivor, legacyIds } = coalesceTaskboardRows(rows as Array<{ id?: number; entries: TaskboardEntry[]; createdAt?: Date; updatedAt?: Date }>)

  if (legacyIds.length > 0) {
    await taskboardsTable.bulkDelete(legacyIds)
  }

  if (survivor.id != null) {
    await taskboardsTable.update(survivor.id, {
      entries: survivor.entries,
      updatedAt: survivor.updatedAt,
      // Strip `name` — Dexie's update doesn't drop keys on its own, so use
      // modify inside a follow-up query.
    })
    await taskboardsTable.where(':id').equals(survivor.id).modify((row) => {
      delete (row as unknown as Record<string, unknown>).name
    })
  } else if (rows.length === 0) {
    // No row yet — seed an empty one so `load()` finds something post-migration.
    await taskboardsTable.add({
      entries: [],
      createdAt: survivor.createdAt,
      updatedAt: survivor.updatedAt,
    } as Taskboard)
  }

  await floatingTable.toCollection().modify((row) => {
    const r = row as unknown as Record<string, unknown>
    if ('taskboardId' in r) delete r.taskboardId
  })

  const railsSetting = await settingsTable.get('canvasRails')
  if (railsSetting) {
    const next = stripRailsTaskboardIds(railsSetting.value)
    if (next !== railsSetting.value && next != null) {
      await settingsTable.put({ key: 'canvasRails', value: next })
    }
  }

  await settingsTable.delete('defaultTaskboardId')

  console.info(`v33 migration: coalesced ${rows.length} taskboard row(s) into 1; stripped taskboardId from floats + rails`)
}

/**
 * v31 upgrade: strip the legacy `color` key from every person row. Color is
 * now derived at render time from the person's first assigned org. Rows that
 * never had a color (post-v31 inserts) are skipped.
 */
export async function runV31Migration(tx: Transaction): Promise<void> {
  let stripped = 0
  await tx.table('people').toCollection().modify((row: Record<string, unknown>) => {
    if ('color' in row) {
      delete row.color
      stripped++
    }
  })
  if (stripped > 0) console.info(`v31 migration: stripped color from ${stripped} person row(s)`)
}

/**
 * v34 upgrade: flatten — delete `parentId` from every todo row. The schema
 * string dropped the matching index; this pass clears the data. One-way:
 * existing parent-child links are lost.
 */
export async function runV34Migration(tx: Transaction): Promise<void> {
  let stripped = 0
  await tx.table('todos').toCollection().modify((row: Record<string, unknown>) => {
    if ('parentId' in row) {
      delete row.parentId
      stripped++
    }
  })
  if (stripped > 0) console.info(`v34 migration: stripped parentId from ${stripped} todo row(s)`)
}

/**
 * Collect unique tag slugs (lowercase) from every todo's inline `tags` field
 * in first-seen order, plus a per-todo slug list for emitting `todoTags` join
 * rows. Case-folds, trims, drops empties. Pure — shared between the in-place
 * v36 migration and the post-v35 restore branch.
 */
export function buildTagRegistryFromInline(
  todos: Array<{ id?: number; tags?: unknown }>,
): { uniqueSlugs: string[]; joinsByTodoId: Map<number, string[]> } {
  const seen = new Set<string>()
  const ordered: string[] = []
  const joinsByTodoId = new Map<number, string[]>()
  for (const t of todos) {
    if (!Array.isArray(t.tags) || typeof t.id !== 'number') continue
    const perTodo: string[] = []
    for (const raw of t.tags) {
      if (typeof raw !== 'string') continue
      const slug = raw.trim().toLowerCase()
      if (slug.length === 0) continue
      if (!seen.has(slug)) { seen.add(slug); ordered.push(slug) }
      perTodo.push(slug)
    }
    if (perTodo.length > 0) joinsByTodoId.set(t.id, perTodo)
  }
  return { uniqueSlugs: ordered, joinsByTodoId }
}

/**
 * In-place translate a `tags` array on a stored object from `string[]`
 * (case-folded lookup) to `number[]` (tag ids). No-op when `tags` is not an
 * array. Entries already stored as numbers pass through (keeps the function
 * idempotent if the migration runs twice). Unknown slug names are collected
 * via `unknownCollector` so the caller can log them once. Returns true when
 * the field was translated.
 */
export function translatePredicateTagsInPlace(
  obj: Record<string, unknown>,
  slugToId: Map<string, number>,
  unknownCollector: Set<string>,
): boolean {
  const raw = obj.tags
  if (!Array.isArray(raw)) return false
  const translated: number[] = []
  for (const s of raw) {
    if (typeof s === 'number' && Number.isInteger(s)) {
      translated.push(s)
      continue
    }
    if (typeof s !== 'string') continue
    const slug = s.trim().toLowerCase()
    if (slug.length === 0) continue
    const id = slugToId.get(slug)
    if (id != null) translated.push(id)
    else unknownCollector.add(slug)
  }
  obj.tags = translated
  return true
}

/** Translate `membership.predicate.tags` on a list-definition row. No-op for non-custom membership. */
export function translateListDefinitionTagsInPlace(
  def: Record<string, unknown>,
  slugToId: Map<string, number>,
  unknownCollector: Set<string>,
): boolean {
  const m = def.membership as Record<string, unknown> | undefined
  if (!m || m.kind !== 'custom') return false
  const p = m.predicate as Record<string, unknown> | undefined
  if (!p) return false
  return translatePredicateTagsInPlace(p, slugToId, unknownCollector)
}

/** Translate `filters.tags` on a saved-view row. */
export function translateSavedViewTagsInPlace(
  sv: Record<string, unknown>,
  slugToId: Map<string, number>,
  unknownCollector: Set<string>,
): boolean {
  const f = sv.filters as Record<string, unknown> | undefined
  if (!f) return false
  return translatePredicateTagsInPlace(f, slugToId, unknownCollector)
}

/**
 * v36 upgrade: recreate the `tags` + `todoTags` tables (dropped by v29),
 * seed them from inline `todo.tags` slugs, and translate stored predicate /
 * saved-view `tags` clauses from `string[]` to `number[]`. Inline `todo.tags`
 * is preserved transiently (Phase 9 removes it).
 */
export async function runV36Migration(tx: Transaction): Promise<void> {
  const todosTable = tx.table('todos')
  const tagsTable = tx.table<Tag>('tags')
  const todoTagsTable = tx.table<TodoTag>('todoTags')

  const todos = await todosTable.toArray() as Array<{ id?: number; tags?: unknown }>
  const { uniqueSlugs, joinsByTodoId } = buildTagRegistryFromInline(todos)

  const slugToId = new Map<string, number>()
  for (const slug of uniqueSlugs) {
    const id = (await tagsTable.add({ name: slug, color: DEFAULT_ENTITY_COLOR } as Tag)) as number
    slugToId.set(slug, id)
  }

  const joins: Array<Omit<TodoTag, 'id'>> = []
  for (const [todoId, slugs] of joinsByTodoId) {
    for (const slug of slugs) {
      const tagId = slugToId.get(slug)
      if (tagId != null) joins.push({ todoId, tagId })
    }
  }
  if (joins.length > 0) await todoTagsTable.bulkAdd(joins as TodoTag[])

  const unknownCollector = new Set<string>()
  await tx.table('listDefinitions').toCollection().modify((def: Record<string, unknown>) => {
    translateListDefinitionTagsInPlace(def, slugToId, unknownCollector)
  })
  await tx.table('savedViews').toCollection().modify((sv: Record<string, unknown>) => {
    translateSavedViewTagsInPlace(sv, slugToId, unknownCollector)
  })
  if (unknownCollector.size > 0) {
    console.warn(
      `v36 migration: dropped ${unknownCollector.size} unknown tag name(s) from stored predicates: ${[...unknownCollector].join(', ')}`,
    )
  }

  console.info(`v36 migration: seeded ${uniqueSlugs.length} tag(s) + ${joins.length} assignment(s) from inline`)
}

/**
 * v37 upgrade: delete the transient inline `tags` key from every todo row.
 * The registry (`tags` + `todoTags` tables seeded in v36) is now the sole
 * source of truth. Idempotent — todos without the key skip the write.
 */
export async function runV37Migration(tx: Transaction): Promise<void> {
  let stripped = 0
  await tx.table('todos').toCollection().modify((row: Record<string, unknown>) => {
    if ('tags' in row) {
      delete row.tags
      stripped++
    }
  })
  if (stripped > 0) console.info(`v37 migration: stripped inline tags from ${stripped} todo row(s)`)
}
