import Dexie, { type Table } from 'dexie'
import type { TodoItem, Project, Canvas, Person, TodoPerson, TodoOrg, PersonOrg, ListInset, Org, Backup, Taskboard, TaskboardEntry, Status, Note, FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingHorizons, FloatingStatus, FloatingScoreboard, FloatingSnoozeGraveyard, Tag, TodoTag, TodoEvent, TodoSortBy, TodoGroupBy } from '../models'
import { isTodoSortBy, isTodoGroupBy } from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { TodoPredicate, DateAnchor } from '../models/filter-predicate'

export interface SettingRow {
  key: string
  value: string
}

/**
 * Authoritative current Dexie schema version. Used in two places:
 *
 *   1. The final `this.version(CURRENT_DB_VERSION)` call below — bumping the
 *      schema means bumping this constant in the same edit.
 *   2. `services/migration-check.ts` reads it to decide whether to prompt the
 *      user before Dexie upgrades the on-disk IDB store. There is a vitest
 *      that asserts `db.verno === CURRENT_DB_VERSION` after open, so a future
 *      schema bump that adds `this.version(N+1)` without updating this
 *      constant will fail the test (the schema-upgrade prompt would otherwise
 *      silently regress, as it has done historically).
 */
export const CURRENT_DB_VERSION = 48

/**
 * Lowest database version this build will silently load. A database whose
 * on-disk version (or imported file's `__schemaVersion`) is below this floor
 * triggers a warning dialog before any restore or Dexie upgrade runs —
 * legacy translators have been removed for older shapes and proceeding may
 * permanently lose data.
 *
 * Policy: this constant rises over time. After each progressive strip it
 * jumps back up to CURRENT_DB_VERSION; in the rare case a release wants to
 * keep one prior version readable it may sit at CURRENT_DB_VERSION - N
 * temporarily. Never raise this without auditing import-validation.ts +
 * restore.ts to confirm the dropped versions truly have no consumers.
 */
export const OLDEST_SUPPORTED_DB_VERSION = CURRENT_DB_VERSION

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
  taskboards!: Table<Taskboard, number>
  statuses!: Table<Status, number>
  listDefinitions!: Table<ListDefinition, number>
  notes!: Table<Note, number>
  floatingCalendars!: Table<FloatingCalendar, number>
  floatingNotes!: Table<FloatingNote, number>
  floatingTaskboards!: Table<FloatingTaskboard, number>
  floatingHorizons!: Table<FloatingHorizons, number>
  floatingStatus!: Table<FloatingStatus, number>
  floatingScoreboard!: Table<FloatingScoreboard, number>
  floatingSnoozeGraveyard!: Table<FloatingSnoozeGraveyard, number>
  tags!: Table<Tag, number>
  todoTags!: Table<TodoTag, number>
  todoEvents!: Table<TodoEvent, number>

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
    })

    // v21: unify scheduling — drop priority + isHardDeadline, add scheduledDate,
    // seed listDefinitions (Today / Upcoming / Deadlines / Someday), and remove
    // retired 'high-priority' / priority-attribute list insets.
    this.version(21).stores({
      todos: '++id, projectId, canvasId, parentId, isCompleted, dueDate, sortOrder, statusId',
      listInsets: '++id, canvasId',
      listDefinitions: '++id, sortOrder',
    })

    // v22: list-definitions builder DSL — add `pinnedToDashboard`, drop
    // `seededKey`. No index change (both fields are stored inline).
    this.version(22).stores({})

    // v23: canvas list-inset unification — drop `preset` / `attributeFilter` /
    // `name` on `ListInset`; each row gains `listDefinitionId` referencing a
    // freshly-created (unpinned) `ListDefinition`.
    this.version(23).stores({})

    // v24: horizon-ribbon reseed — retire the today/upcoming/deadlines/someday
    // ListMembership kinds; clear listDefinitions and reseed with 5 horizon
    // custom-predicate defs (ThisWeek / NextWeek / RestOfMonth / Later /
    // Someday); write the `horizonSlots` setting mapping each horizon to the
    // new def id. No users on this branch at the time of the migration, so
    // clearing is acceptable.
    this.version(24).stores({})

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
    })

    // v29: remove the tags feature entirely. For each todo with assigned tags,
    // append " #tagname" to its title (preserving discoverability via the
    // text-search predicate). Strip `tagIds` from any custom predicate stored
    // inside `listDefinitions` and `savedViews`. Drop the `tags` and
    // `todoTags` tables.
    this.version(29).stores({
      tags: null,
      todoTags: null,
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
    })

    // v31: drop `color` from `people`. Person color is now derived from the
    // person's first assigned org (`personOrgs` join + `orgs.color`). Strips
    // the key from every row; no data loss beyond the color itself. Idempotent
    // on post-v31 rows (no-op when the key is already absent).
    this.version(31).stores({})

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

    // v34: flatten — remove parent-child hierarchy. Restate the todos schema
    // string without `parentId` so Dexie drops the index; walk every row and
    // delete the `parentId` key.
    this.version(34)
      .stores({
        todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId',
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

    // v37: tags v2 cutover — delete the transient inline `tags` key from every
    // todo row. Schema string unchanged (the field was never indexed). The
    // registry + `todoTags` joins seeded in v36 are now the sole source of
    // truth for tag data.
    this.version(37)
      .stores({})

    // v38: add `floatingHorizons` table — backing store for the horizon widget
    // popped out to canvas (Phase 5 of features-batch-2026-04). No data
    // migration; the table starts empty. Mirrors the v27 floatingCalendars
    // bump + v33 floatingTaskboards shape (placement-only; ribbon state lives
    // in settings).
    this.version(38).stores({
      floatingHorizons: '++id, canvasId',
    })

    // v39: fold `savedViews` into `listDefinitions`. Every SavedView row
    // becomes a `ListDefinition` with `favorited: true` + `pinnedToDashboard:
    // false`, carrying over sort/grouping/filters/maxTasks/limitMode via the
    // `savedViewToListDefinition` translator. Drops the `savedViews` table and
    // backfills `favorited: false` on every pre-existing ListDefinition.
    this.version(39)
      .stores({
        savedViews: null,
      })

    // v40: add optional `groupBy` + `groupOrder` to projects (Phase 2 of
    // task-grouping). Both fields are stored inline and neither is indexed, so
    // the schema string is unchanged — version bump is for auditability.
    // Existing rows need no rewriting (omitted fields are read as undefined).
    this.version(40).stores({})

    // v41: lift runtime-filter pick from scalar to array (lists-consistency
    // P5). Walks `listInsets` rows and rewrites `runtimeFilterValue: number`
    // → `[number]`; walks `settings.canvasRails` JSON and lifts every tab's
    // scalar `runtimeFilterValue` to a single-entry array. Idempotent — rows
    // already in the array shape pass through unchanged.
    this.version(41).stores({})

    // v42: add `todoEvents` history-log table (Phase 3 of
    // stats-widgets-2026-04-25). Append-only `{ todoId, type, fromValue,
    // toValue, timestamp }`. Backfills `created` events for every existing
    // todo at `createdAt`, and `completed` events at `completedAt` for any
    // currently-completed rows. No `scheduled` / `deadline` / `status` /
    // `reopened` history is synthesised — we don't have it.
    this.version(42)
      .stores({
        todoEvents: '++id, todoId, type, timestamp',
      })

    // v43: add `floatingStatus` table — placement-only backing store for the
    // status stat widget (Phase 1 of stats-widgets-2026-04-25). Mirrors v38
    // floatingHorizons / v27 floatingCalendars; widget content is derived
    // from todo + status state.
    this.version(43).stores({
      floatingStatus: '++id, canvasId',
    })

    // v44: add `floatingScoreboard` table — placement-only backing store for
    // the discipline scoreboard stat widget. Same shape as v43.
    this.version(44).stores({
      floatingScoreboard: '++id, canvasId',
    })

    // v45: add `floatingSnoozeGraveyard` table — placement-only backing store
    // for the snooze-graveyard stat widget. Same shape as v43.
    this.version(45).stores({
      floatingSnoozeGraveyard: '++id, canvasId',
    })

    // v46: flatten `ListDefinition.sort` / `.grouping` from discriminated
    // unions to flat `TodoSortBy` / `TodoGroupBy` literals
    // (ui-consistency-2026-04-25 P4). The former `{kind:'sortBy', by:X}` /
    // `{kind:'sort-order'}` / `{kind:'effective-date-asc'}` etc. collapse to
    // single strings; the former `{kind:'by-sortBy'}` "match the sort"
    // semantic is converted to whichever flat literal the sort field now
    // carries (or `'none'` when the sort is not a valid grouping field).
    // Idempotent — rows already in the flat shape pass through unchanged.
    this.version(46).stores({})

    // v47: was a runtimeFilter discriminated-union migration that wrapped
    // the legacy `{ field, label? }` as `{ kind: 'value', ... }`. Reverted
    // before any user data depended on the new shape; v48 unwinds it. The
    // version is preserved as an empty marker so users whose local DB had
    // already advanced to v47 can still open without a Dexie version error.
    this.version(47).stores({})

    // v48: unwind the v47 wrap. Flattens `{ kind: 'value', field, label? }`
    // back to `{ field, label? }` and drops any experimental
    // `{ kind: 'date-offset', ... }` rows (the offset capability now rides
    // `DateAnchor` instead — see filter-predicate.ts). Idempotent.
    // The version literal is the same as `CURRENT_DB_VERSION`; using the
    // constant here is what enforces the single-source-of-truth invariant
    // (see the constant's docblock above).
    this.version(CURRENT_DB_VERSION).stores({})
  }
}

export const db = new Todo2Database()

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
 * Seed configuration for the 5 horizon list-definitions. Rendered as the
 * default rows of the horizons widget; each becomes one entry in the
 * `settings.horizonSlots` ordered array. P6 retired the per-row
 * `HorizonKey` identity — order is now the only seed-vs-seed identity.
 */
interface HorizonSeed {
  def: Omit<ListDefinition, 'id'>
}

function horizonSeeds(): HorizonSeed[] {
  return [
    {
      def: {
        name: 'This week',
        sortOrder: 0,
        pinnedToDashboard: true,
        favorited: false,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('start-of-week'),
            dateRangeEnd: relAnchor('end-of-week'),
          },
        },
        sort: 'date',
        grouping: 'none',
      },
    },
    {
      def: {
        name: 'Next week',
        sortOrder: 1,
        pinnedToDashboard: true,
        favorited: false,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('start-of-next-week'),
            dateRangeEnd: relAnchor('end-of-next-week'),
          },
        },
        sort: 'date',
        grouping: 'none',
      },
    },
    {
      def: {
        name: 'Rest of month',
        sortOrder: 2,
        pinnedToDashboard: true,
        favorited: false,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('tomorrow'),
            dateRangeEnd: relAnchor('end-of-month'),
          },
        },
        sort: 'date',
        grouping: 'none',
      },
    },
    {
      def: {
        name: 'Later',
        sortOrder: 3,
        pinnedToDashboard: true,
        favorited: false,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            dateField: 'date',
            dateRangeStart: relAnchor('start-of-next-month'),
            dateRangeEnd: relAnchor('end-of-month-plus-3'),
          },
        },
        sort: 'date',
        grouping: 'date',
      },
    },
    {
      def: {
        name: 'Someday',
        sortOrder: 4,
        pinnedToDashboard: true,
        favorited: false,
        membership: {
          kind: 'custom',
          predicate: {
            ...basePredicate(),
            hasScheduled: false,
            hasDeadline: false,
          },
        },
        sort: 'manual',
        grouping: 'none',
      },
    },
  ]
}

/**
 * Seeds the 5 horizon list definitions iff the `listDefinitions` table is
 * empty. Returns the new ids in seed order (matching `horizonSeeds()`'s
 * iteration order — This week / Next week / Rest of month / Later /
 * Someday) when seeding happens; returns an empty array when the table is
 * non-empty (caller should load existing `horizonSlots` from settings).
 *
 * Used by `restoreFromImportData` (after clear) — the seeds are just normal
 * rows; if the user deletes them they stay deleted, if they rename them the
 * rename persists.
 */
export async function ensureSeededListDefinitions(
  table: Table<ListDefinition, number>,
): Promise<number[]> {
  const count = await table.count()
  if (count > 0) return []

  const ids: number[] = []
  for (const { def } of horizonSeeds()) {
    const id = (await table.add(def as ListDefinition)) as number
    ids.push(id)
  }
  return ids
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
      favorited: false,
      membership: {
        kind: 'custom',
        predicate: predicate as unknown as import('../models').TodoPredicate,
      },
      sort: 'date',
      grouping: 'none',
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
      favorited: false,
      membership: {
        kind: 'custom',
        predicate: predicate as unknown as import('../models').TodoPredicate,
      },
      sort: 'manual',
      grouping: 'none',
    }
  }

  return null
}

/**
 * Writes `settings.horizonSlots` as JSON (one row). Post-P6 this is a plain
 * `number[]` of `ListDefinition.id`s (the order users see on the horizons
 * widget); `parseHorizonSlots` still accepts the legacy
 * `Partial<Record<HorizonKey, number>>` shape for older backups.
 */
export async function persistHorizonSlots(
  settingsTable: Table<SettingRow, string>,
  slots: number[],
): Promise<void> {
  await settingsTable.put({ key: 'horizonSlots', value: JSON.stringify(slots) })
}

/** All data tables (excludes backups). Used for export, import, and file-storage sync. */
export const ALL_DATA_TABLES = [db.todos, db.projects, db.canvases, db.listInsets, db.people, db.settings, db.todoPeople, db.todoOrgs, db.personOrgs, db.orgs, db.taskboards, db.statuses, db.listDefinitions, db.notes, db.floatingCalendars, db.floatingNotes, db.floatingTaskboards, db.floatingHorizons, db.floatingStatus, db.floatingScoreboard, db.floatingSnoozeGraveyard, db.tags, db.todoTags, db.todoEvents] as const

/**
 * Append `" #tagname"` for every assigned tag to each todo's title. Pure over
 * its inputs — shared with `restoreFromImportData` for legacy JSON imports.
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
 * Translate a legacy note row carrying canvasId + placement fields (post-v26
 * shape) into a placement-only `floatingNotes` row. Content and color are
 * dropped — v28 collapses all canvas floating notes into views of the single
 * global note, so per-row content no longer exists.
 *
 * Pure function — shared with restore-time handling of pre-v28 backups.
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
 * Translate a legacy sticky-note row (title, text, canvasId, x/y/w/h, color,
 * createdAt, modifiedAt) into the matching `notes` row. Title, when present,
 * is prepended as an H1 so it's visible in the Markdown editor.
 *
 * Pure function — shared with restore-time translation of legacy backups.
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
 * Collapse a multi-row `taskboards` table into a single row (union entries,
 * dedupe by `todoId`, keep first-seen sort order; drop `name`). Pure over its
 * input — used by `restoreFromImportData` for legacy backups.
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
  if (!survivor) {
    const now = new Date()
    return { survivor: { entries: [], createdAt: now, updatedAt: now }, legacyIds: [] }
  }
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
    legacyIds: sorted.slice(1).map((r) => r.id).filter((id): id is number => id != null),
  }
}

/**
 * Collect unique tag slugs (lowercase) from every todo's inline `tags` field
 * in first-seen order, plus a per-todo slug list for emitting `todoTags` join
 * rows. Case-folds, trims, drops empties. Pure — used by `restoreFromImportData`
 * for legacy backups whose tag rows are still inline strings.
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
 * Translate a legacy `ListSort` discriminated-union value into the flat
 * `TodoSortBy` literal. Idempotent — already-flat strings are returned
 * unchanged when valid; unknown shapes fall back to `'manual'`.
 *
 * Mapping:
 *   `{kind:'sort-order'}`         → `'manual'`
 *   `{kind:'effective-date-asc'}` → `'date'`
 *   `{kind:'scheduled-asc'}`      → `'scheduled'`
 *   `{kind:'deadline-asc'}`       → `'deadline'`
 *   `{kind:'sortBy', by:X}`       → `X` (when X is a valid TodoSortBy)
 *
 * Used by `import-validation.ts` to normalize legacy-shape backups into the
 * flat literal at validate-time.
 */
export function flattenListSortValue(raw: unknown): TodoSortBy {
  if (typeof raw === 'string') {
    return isTodoSortBy(raw) ? raw : 'manual'
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    switch (obj.kind) {
      case 'sort-order': return 'manual'
      case 'effective-date-asc': return 'date'
      case 'scheduled-asc': return 'scheduled'
      case 'deadline-asc': return 'deadline'
      case 'sortBy': {
        const by = obj.by
        if (typeof by === 'string' && isTodoSortBy(by)) return by
        return 'manual'
      }
    }
  }
  return 'manual'
}

/**
 * Translate a legacy `ListGrouping` discriminated-union value into the flat
 * `TodoGroupBy` literal. Idempotent on flat strings; unknown shapes fall back
 * to `'none'`. The former `{kind:'by-sortBy'}` "match the sort" semantic is
 * resolved against the supplied `flatSort` — if the sort is a valid grouping
 * field, that field becomes the grouping; otherwise `'none'`.
 *
 * Mapping:
 *   `{kind:'none'}`               → `'none'`
 *   `{kind:'relative-effective'}` → `'date'`
 *   `{kind:'relative-deadline'}`  → `'deadline'`
 *   `{kind:'by-tag'}`             → `'tag'`
 *   `{kind:'by-field', by:X}`     → `X` (when X is a valid TodoGroupBy)
 *   `{kind:'by-sortBy'}`          → `flatSort` (when valid TodoGroupBy) | `'none'`
 *
 * Used by `import-validation.ts` alongside `flattenListSortValue`.
 */
export function flattenListGroupingValue(raw: unknown, flatSort: TodoSortBy): TodoGroupBy {
  if (typeof raw === 'string') {
    return isTodoGroupBy(raw) ? raw : 'none'
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    switch (obj.kind) {
      case 'none': return 'none'
      case 'relative-effective': return 'date'
      case 'relative-deadline': return 'deadline'
      case 'by-tag': return 'tag'
      case 'by-sortBy':
        return isTodoGroupBy(flatSort) ? flatSort : 'none'
      case 'by-field': {
        const by = obj.by
        if (typeof by === 'string' && isTodoGroupBy(by)) return by
        return 'none'
      }
    }
  }
  return 'none'
}

