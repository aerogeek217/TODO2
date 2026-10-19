import Dexie, { type Table } from 'dexie'
import type { TodoItem, Person, TodoPerson, Backup, Status, Note, Tag, TodoTag, TodoEvent, ListOrder } from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { SETTING_KEYS } from './setting-keys'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { applySchemaUpgradeInTx } from './schema-upgrades'
import { DATA_TABLE_NAMES, type DataTableName, type DataTableRows } from './tables'

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
export const CURRENT_DB_VERSION = 65

/**
 * Lowest database version this build will silently load. A database whose
 * on-disk version (or imported file's `__schemaVersion`) is below this floor
 * triggers a warning dialog before any restore or Dexie upgrade runs —
 * legacy translators have been removed for older shapes and proceeding may
 * permanently lose data.
 *
 * Files at or above the floor import through the permanent upgrade pipeline
 * (`data/schema-upgrades.ts` → `upgradeDataSet`), which runs the same
 * per-version transforms as the Dexie `.upgrade()` callbacks.
 *
 * Policy: PINNED as a literal. Never raise it automatically (and never derive
 * it from CURRENT_DB_VERSION) — raising it is a deliberate, user-approved
 * decision, because it stops older backups / sync files from importing.
 * Raising it also permits deleting the registry entries at or below the new
 * floor.
 */
export const OLDEST_SUPPORTED_DB_VERSION = 49

export class Todo2Database extends Dexie {
  todos!: Table<TodoItem, number>
  people!: Table<Person, number>
  settings!: Table<SettingRow, string>
  todoPeople!: Table<TodoPerson, number>
  backups!: Table<Backup, number>
  statuses!: Table<Status, number>
  listDefinitions!: Table<ListDefinition, number>
  notes!: Table<Note, number>
  tags!: Table<Tag, number>
  todoTags!: Table<TodoTag, number>
  todoEvents!: Table<TodoEvent, number>
  layouts!: Table<WorkspaceLayout, number>
  listOrders!: Table<ListOrder, number>

  constructor() {
    super('todo2')

    // v16 – v48: the store layouts of the versions below the supported floor
    // (`OLDEST_SUPPORTED_DB_VERSION`, v49). Dexie needs every version that
    // changed a store to open (and upgrade) an older database; the data
    // upgrades those versions ran are gone, so a database older than the
    // floor gets the migration warning first (`services/migration-check`).
    // Each line names what the version changed, for the record.

    // v16: the base schema (the oldest layout this build can open).
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
    // v17: org initials (no store change).
    this.version(17).stores({})
    // v18: the taskboard entries table.
    this.version(18).stores({
      taskboardEntries: '++id, todoId, sortOrder',
    })
    // v19: statuses + the `statusId` index.
    this.version(19).stores({
      statuses: '++id, sortOrder',
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, isStarred, dueDate, sortOrder, statusId',
    })
    // v20: starred / assigned folded into statuses; `isStarred` index dropped.
    this.version(20).stores({
      todos: '++id, projectId, canvasId, parentId, priority, isCompleted, dueDate, sortOrder, statusId',
      statuses: '++id, sortOrder',
      listInsets: '++id, canvasId',
      settings: 'key',
    })
    // v21: priority dropped; list definitions added.
    this.version(21).stores({
      todos: '++id, projectId, canvasId, parentId, isCompleted, dueDate, sortOrder, statusId',
      listInsets: '++id, canvasId',
      listDefinitions: '++id, sortOrder',
    })
    // v22 – v24: list definition reshapes (no store change).
    this.version(22).stores({})
    this.version(23).stores({})
    this.version(24).stores({})
    // v25: the notes table.
    this.version(25).stores({
      notes: '++id, modifiedAt',
    })
    // v26: sticky notes merged into notes.
    this.version(26).stores({
      notes: '++id, modifiedAt, canvasId',
      stickyNotes: null,
    })
    // v27: floating calendars.
    this.version(27).stores({
      floatingCalendars: '++id, canvasId',
    })
    // v28: floating notes.
    this.version(28).stores({
      floatingNotes: '++id, canvasId',
    })
    // v29: tags removed (v36 brought them back).
    this.version(29).stores({
      tags: null,
      todoTags: null,
    })
    // v30: taskboards as records + floating taskboards.
    this.version(30).stores({
      taskboardEntries: null,
      taskboards: '++id',
      floatingTaskboards: '++id, canvasId, taskboardId',
    })
    // v31, v32: person colour dropped; calendar orientation (no store change).
    this.version(31).stores({})
    this.version(32).stores({})
    // v33: one taskboard; the `taskboardId` index dropped.
    this.version(33)
      .stores({
        floatingTaskboards: '++id, canvasId',
      })
    // v34: subtasks flattened; the `parentId` index dropped.
    this.version(34)
      .stores({
        todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId',
      })
    // v35: inline tags on tasks (no store change).
    this.version(35).stores({})
    // v36: the tags and tag assignment tables again.
    this.version(36)
      .stores({
        tags: '++id, name',
        todoTags: '++id, todoId, tagId',
      })
    // v37: inline tags removed (no store change).
    this.version(37)
      .stores({})
    // v38: floating horizons.
    this.version(38).stores({
      floatingHorizons: '++id, canvasId',
    })
    // v39: saved views folded into list definitions.
    this.version(39)
      .stores({
        savedViews: null,
      })
    // v40, v41: project grouping; runtime filter picks as arrays (no store change).
    this.version(40).stores({})
    this.version(41).stores({})
    // v42: the task history (`todoEvents`).
    this.version(42)
      .stores({
        todoEvents: '++id, todoId, type, timestamp',
      })
    // v43 – v45: the floating status, scoreboard and snooze-graveyard widgets.
    this.version(43).stores({
      floatingStatus: '++id, canvasId',
    })
    this.version(44).stores({
      floatingScoreboard: '++id, canvasId',
    })
    this.version(45).stores({
      floatingSnoozeGraveyard: '++id, canvasId',
    })
    // v46 – v48: list sort / grouping and runtime filter reshapes (no store change).
    this.version(46).stores({})
    this.version(47).stores({})
    this.version(48).stores({})

    // v49: stamp `setAt: Date` onto every fuzzy `scheduledDate`. For each
    // fuzzy todo missing the field, look up the most recent `'scheduled'`
    // todoEvent for that row — its timestamp is exactly when the user picked
    // the current fuzzy value (the repository emits a `'scheduled'` event on
    // every `scheduledDate` mutation; see `todo-repository.ts`). When no
    // event exists (pre-v42 task untouched since v42 shipped), fall back to
    // `todo.createdAt`. `modifiedAt` is the wrong fallback — it advances on
    // unrelated edits (title rename, status change). Idempotent: only rows
    // with `kind === 'fuzzy'` and missing `setAt` are rewritten.
    this.version(49).stores({}).upgrade(async (tx) => {
      const scheduledEvents = await tx.table('todoEvents')
        .where('type').equals('scheduled')
        .toArray()
      const lastScheduledByTodo = new Map<number, string>()
      for (const ev of scheduledEvents) {
        const prev = lastScheduledByTodo.get(ev.todoId)
        if (prev === undefined || ev.timestamp > prev) {
          lastScheduledByTodo.set(ev.todoId, ev.timestamp)
        }
      }
      await tx.table('todos').toCollection().modify((todo) => {
        const sd = todo.scheduledDate
        if (!sd || sd.kind !== 'fuzzy') return
        if (sd.setAt) return
        const eventTs = lastScheduledByTodo.get(todo.id)
        const setAt = eventTs ? new Date(eventTs) : todo.createdAt
        todo.scheduledDate = { ...sd, setAt }
      })
    })

    // v50: normalize every Date field to a real `Date`. Imports and
    // sync-file loads used to write JSON's ISO strings straight into the DB.
    // First registry-driven version — the transform (`upgrades/v50-revive-dates.ts`)
    // also runs on imported v49 files via `prepareImport`.
    this.version(50).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 50))

    // v51: `TodoItem.uid` (stable identity, unique index) + `completedAt`
    // (the retention purge's clock). The transform
    // (`upgrades/v51-uid-completed-at.ts`) backfills both. IndexedDB builds
    // the unique index before the upgrade callback runs; rows without a
    // `uid` are simply not indexed, so creation can't fail on old rows.
    this.version(51)
      .stores({
        todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId, &uid',
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 51))

    // v52: remove the horizons, discipline-scoreboard and snooze-graveyard
    // widgets. Drops their placement tables; the transform
    // (`upgrades/v52-drop-date-stat-widgets.ts`) deletes the horizons settings
    // rows and strips those widget tabs from `settings.canvasRails`.
    this.version(52)
      .stores({
        floatingHorizons: null,
        floatingScoreboard: null,
        floatingSnoozeGraveyard: null,
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 52))

    // v53: remove the scheduled date. No index change (`scheduledDate` was
    // never indexed); the transform (`upgrades/v53-remove-scheduled-date.ts`)
    // moves scheduled days into `nextFollowupAt` (or `dueDate` for recurrence
    // anchors), rewrites list definitions / group-by settings that used the
    // removed date fields, and drops the seeded follow-up status pointer.
    this.version(53).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 53))

    // v54: remove hide-by-status. No index change; the transform
    // (`upgrades/v54-remove-hidden-statuses.ts`) strips `hideByDefault` from
    // statuses and `showHiddenStatuses` from stored list predicates.
    this.version(54).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 54))

    // v55: merge orgs into people. Drops the org tables; the transform
    // (`upgrades/v55-merge-orgs-into-people.ts`) turns each org into an
    // `Org: <name>` person, org assignments into person assignments, and
    // folds the org filter / group / runtime-filter values into people.
    this.version(55)
      .stores({
        orgs: null,
        todoOrgs: null,
        personOrgs: null,
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 55))

    // v56: workspace layouts (columns → cells → tabs). Adds the `layouts`
    // table; the transform (`upgrades/v56-seed-workspace-layout.ts`) seeds a
    // "Default" layout from the canvas rails + floating widgets and points
    // the `activeLayoutId` setting at it.
    this.version(56)
      .stores({
        layouts: '++id',
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 56))

    // v57: list favorites and saved prompt picks go. No index change; the
    // transform (`upgrades/v57-drop-list-favorites.ts`) strips `favorited`
    // from list definitions and `viewState.runtimeFilterValue` from
    // workspace list tabs.
    this.version(57).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 57))

    // v58: per-list manual order. Adds the `listOrders` table — one rank per
    // (list, task) pair, unique on the pair; nothing to transform (an empty
    // table means every task is unranked).
    this.version(58)
      .stores({
        listOrders: '++id, listDefinitionId, todoId, &[listDefinitionId+todoId]',
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 58))

    // v59: the taskboard becomes Focus. Drops the taskboard tables; the
    // transform (`upgrades/v59-taskboard-to-focus.ts`) marks taskboard tasks
    // `focus`, creates the "Focus" list with their order, and turns taskboard
    // widgets into widgets of that list.
    this.version(59)
      .stores({
        taskboards: null,
        floatingTaskboards: null,
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 59))

    // v60: projects become tags and the canvas goes. Drops the project,
    // canvas, list-inset and floating-widget tables and the `projectId` /
    // `canvasId` indexes (and the old `notes.canvasId` index); the
    // transform (`upgrades/v60-projects-to-tags.ts`) turns each project into
    // a `Project: <name>` tag on its tasks, folds project filters / grouping
    // / sort / prompts in stored lists into tags, and removes the canvas and
    // project settings.
    this.version(60)
      .stores({
        todos: '++id, isCompleted, dueDate, sortOrder, statusId, &uid',
        notes: '++id, modifiedAt',
        projects: null,
        canvases: null,
        listInsets: null,
        floatingCalendars: null,
        floatingNotes: null,
        floatingStatus: null,
      })
      .upgrade((tx) => applySchemaUpgradeInTx(tx, 60))

    // v61: the Focus filter folds into the Markers filter. No index change
    // (`urgent` / `important` task flags aren't indexed); the transform
    // (`upgrades/v61-focus-filter-to-markers.ts`) rewrites stored list
    // predicates from `focus` to `markers`.
    this.version(61).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 61))

    // v62: the Status widget is retired. No index change; the transform
    // (`upgrades/v62-retire-status-widget.ts`) drops every `status` tab from
    // the stored layouts (and the cells / columns that leaves empty).
    this.version(62).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 62))

    // v63: two canvas leftovers go. No index change; the transform
    // (`upgrades/v63-app-background-and-list-pin.ts`) drops the write-only
    // `pinnedToDashboard` from list definitions and renames the
    // `color.<theme>.canvasBg` colour overrides to `color.<theme>.appBg`.
    this.version(63).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 63))

    // v64: date filters per date type; the list and tag caps go. No index
    // change; the transform (`upgrades/v64-date-filters-and-caps.ts`) folds
    // each stored list predicate's date range and has-due-date / has-follow-up
    // filters into `dates` (a clause per date type), and drops the lists'
    // `maxTasks` / `limitMode` and the `maxTags` setting.
    this.version(64).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, 64))

    // v65: a version marker. No index or data change
    // (`upgrades/v65-is-not-and-eisenhower-list.ts` returns its input); v65
    // data may hold list "is not" switches and Eisenhower tabs on a list,
    // which an older build would drop silently, so older builds refuse it.
    // The latest version uses `CURRENT_DB_VERSION` (not a literal): that is
    // what enforces the single-source-of-truth invariant (see the constant's
    // docblock above). When bumping, turn this into a literal `65` first.
    this.version(CURRENT_DB_VERSION).stores({}).upgrade((tx) => applySchemaUpgradeInTx(tx, CURRENT_DB_VERSION))
  }
}

export const db = new Todo2Database()

/**
 * Seeds the built-in "Assigned" status when the settings pointer to it is
 * missing or dangling. Runs after every full restore.
 */
export async function ensureSeededStatuses(
  statusesTable: Table<Status, number>,
  settingsTable: Table<SettingRow, string>,
): Promise<{ assignedId: number }> {
  const assignedSetting = await settingsTable.get(SETTING_KEYS.seededAssignedStatusId)
  const seededAssignedId = assignedSetting ? Number(assignedSetting.value) : null
  const existingAssigned = seededAssignedId != null
    ? await statusesTable.get(seededAssignedId)
    : undefined

  let assignedId = existingAssigned?.id
  if (assignedId == null) {
    const all = await statusesTable.toArray()
    const maxSort = all.reduce((m, s) => Math.max(m, s.sortOrder), -1)
    const seedAssigned: Status = {
      name: 'Assigned', color: DEFAULT_ENTITY_COLOR, sortOrder: maxSort + 1,
      icon: 'person',
    }
    assignedId = (await statusesTable.add(seedAssigned)) as number
  }

  await settingsTable.put({ key: SETTING_KEYS.seededAssignedStatusId, value: String(assignedId) })

  return { assignedId }
}

/**
 * The data tables (the registry in `tables.ts`) by name, typed by row.
 * Assigning `db` here is the compile-time check that the Dexie class
 * declares every registry table with the registry's row type.
 */
export const DATA_TABLES: { readonly [K in DataTableName]: Table<DataTableRows[K], K extends 'settings' ? string : number> } = db

/** All data tables (excludes backups), in export order. Used for export, restore, and file-storage sync. */
export const ALL_DATA_TABLES: readonly Table[] = DATA_TABLE_NAMES.map((name) => DATA_TABLES[name] as Table)

