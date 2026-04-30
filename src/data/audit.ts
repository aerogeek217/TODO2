import { db } from './database'
import {
  KNOWN_DB_TABLES,
  KNOWN_TABLE_KEYS,
  validateRow,
  isKnownSettingKey,
} from './import-validation'

export interface AuditIssue {
  table: string
  description: string
  count: number
  /** IDs of rows to delete (join/taskboard orphans) or update (dangling FK) */
  ids: number[]
  /**
   * String keys for delete-by-key tables. Used by the unknown-setting check —
   * `db.settings` is keyed by `key`, not numeric `id`.
   */
  keys?: string[]
  /**
   * `'drop-store'` wipes an entire IDB object store via raw IDB (Dexie does
   * not expose deleteObjectStore at runtime; the closest safe primitive is
   * `clear()`). The empty store remains until a future schema bump.
   */
  fix: 'delete' | 'clear-field' | 'drop-store'
  field?: string
}

export interface AuditReport {
  issues: AuditIssue[]
  totalOrphans: number
  scannedAt: Date
}

function rawCount(idb: IDBDatabase, name: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const tx = idb.transaction([name], 'readonly')
    const req = tx.objectStore(name).count()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function rawClear(idb: IDBDatabase, name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = idb.transaction([name], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    tx.objectStore(name).clear()
  })
}

/** Scan all tables for orphaned join rows and dangling foreign keys. */
export async function auditData(): Promise<AuditReport> {
  const issues: AuditIssue[] = []

  // --- Unknown IDB object stores (loudest signal of a cross-floor load) ---
  // Walk the native IDB store list rather than `db.tables` so we catch stores
  // left behind by older schemas that are no longer Dexie-registered.
  const idb = db.backendDB()
  const allStoreNames = Array.from(idb.objectStoreNames)
  for (const name of allStoreNames) {
    if (KNOWN_DB_TABLES.has(name)) continue
    const count = await rawCount(idb, name)
    if (count === 0) continue
    issues.push({
      table: name,
      description: `Unknown table "${name}" — drop the entire store`,
      count,
      ids: [],
      fix: 'drop-store',
      field: '__store__',
    })
  }

  const [
    todos, projects, canvases, people, orgs, statuses, tags,
    todoPeople, todoOrgs, todoTags, personOrgs, taskboards,
    listInsets, floatingNotes, floatingCalendars, floatingTaskboards, floatingHorizons,
    floatingStatus, floatingScoreboard, floatingSnoozeGraveyard, todoEvents,
    settingsRows, listDefinitions, notes,
  ] = await Promise.all([
    db.todos.toArray(),
    db.projects.toArray(),
    db.canvases.toArray(),
    db.people.toArray(),
    db.orgs.toArray(),
    db.statuses.toArray(),
    db.tags.toArray(),
    db.todoPeople.toArray(),
    db.todoOrgs.toArray(),
    db.todoTags.toArray(),
    db.personOrgs.toArray(),
    db.taskboards.toArray(),
    db.listInsets.toArray(),
    db.floatingNotes.toArray(),
    db.floatingCalendars.toArray(),
    db.floatingTaskboards.toArray(),
    db.floatingHorizons.toArray(),
    db.floatingStatus.toArray(),
    db.floatingScoreboard.toArray(),
    db.floatingSnoozeGraveyard.toArray(),
    db.todoEvents.toArray(),
    db.settings.toArray(),
    db.listDefinitions.toArray(),
    db.notes.toArray(),
  ])

  // --- Unknown rows in known tables ---
  // Run validateRow over every row so a forced cross-floor load surfaces any
  // pre-strip-shape data the current validators reject. Skip `settings` —
  // its check rejects unknown keys, which the dedicated unknown-setting pass
  // handles via delete-by-key.
  const knownTableRows: Partial<Record<string, unknown[]>> = {
    canvases, projects, todos, people, tags, listInsets, todoTags, todoPeople,
    todoOrgs, personOrgs, orgs, taskboards, floatingTaskboards,
    statuses, listDefinitions, notes,
    floatingCalendars, floatingNotes, floatingHorizons,
    floatingStatus, floatingScoreboard, floatingSnoozeGraveyard, todoEvents,
  }
  for (const tableKey of KNOWN_TABLE_KEYS) {
    if (tableKey === 'settings') continue
    const rows = knownTableRows[tableKey] ?? []
    const badIds: number[] = []
    for (const row of rows) {
      if (validateRow(tableKey, row) === true) continue
      const id = (row as { id?: number }).id
      if (typeof id === 'number') badIds.push(id)
    }
    if (badIds.length > 0) {
      issues.push({
        table: tableKey,
        description: `Rows in "${tableKey}" that the current schema cannot read`,
        count: badIds.length,
        ids: badIds,
        fix: 'delete',
      })
    }
  }

  // --- Unknown setting keys ---
  const unknownSettingKeys = settingsRows
    .filter((s) => !isKnownSettingKey(s.key))
    .map((s) => s.key)
  if (unknownSettingKeys.length > 0) {
    issues.push({
      table: 'settings',
      description: 'Unrecognized settings — no UI will read or write them',
      count: unknownSettingKeys.length,
      ids: [],
      keys: unknownSettingKeys,
      fix: 'delete',
    })
  }

  const todoIds = new Set(todos.map((t) => t.id!))
  const projectIds = new Set(projects.map((p) => p.id!))
  const canvasIds = new Set(canvases.map((c) => c.id!))
  const personIds = new Set(people.map((p) => p.id!))
  const orgIds = new Set(orgs.map((o) => o.id!))
  const statusIds = new Set(statuses.map((s) => s.id!))
  const tagIds = new Set(tags.map((t) => t.id!))

  // --- Orphaned join rows ---

  const orphanedTodoPeople = todoPeople.filter(
    (r) => !todoIds.has(r.todoId) || !personIds.has(r.personId),
  )
  if (orphanedTodoPeople.length > 0) {
    issues.push({
      table: 'todoPeople',
      description: 'Person assignments referencing deleted todos or people',
      count: orphanedTodoPeople.length,
      ids: orphanedTodoPeople.map((r) => r.id!),
      fix: 'delete',
    })
  }

  const orphanedTodoOrgs = todoOrgs.filter(
    (r) => !todoIds.has(r.todoId) || !orgIds.has(r.orgId),
  )
  if (orphanedTodoOrgs.length > 0) {
    issues.push({
      table: 'todoOrgs',
      description: 'Org assignments referencing deleted todos or orgs',
      count: orphanedTodoOrgs.length,
      ids: orphanedTodoOrgs.map((r) => r.id!),
      fix: 'delete',
    })
  }

  const orphanedPersonOrgs = personOrgs.filter(
    (r) => !personIds.has(r.personId) || !orgIds.has(r.orgId),
  )
  if (orphanedPersonOrgs.length > 0) {
    issues.push({
      table: 'personOrgs',
      description: 'Person-org memberships referencing deleted people or orgs',
      count: orphanedPersonOrgs.length,
      ids: orphanedPersonOrgs.map((r) => r.id!),
      fix: 'delete',
    })
  }

  const orphanedTodoTags = todoTags.filter(
    (r) => !todoIds.has(r.todoId) || !tagIds.has(r.tagId),
  )
  if (orphanedTodoTags.length > 0) {
    issues.push({
      table: 'todoTags',
      description: 'Tag assignments referencing deleted todos or tags',
      count: orphanedTodoTags.length,
      ids: orphanedTodoTags.map((r) => r.id!),
      fix: 'delete',
    })
  }

  const orphanedTodoEvents = todoEvents.filter((r) => !todoIds.has(r.todoId))
  if (orphanedTodoEvents.length > 0) {
    issues.push({
      table: 'todoEvents',
      description: 'Event-log entries referencing deleted todos',
      count: orphanedTodoEvents.length,
      ids: orphanedTodoEvents.map((r) => r.id!),
      fix: 'delete',
    })
  }

  // Entries inside each taskboard pointing at deleted todos are reported per-board
  // (fix: 'clear-field' writes back a filtered entries list).
  const taskboardsWithOrphanedEntries = taskboards.filter((t) =>
    t.entries.some((e) => !todoIds.has(e.todoId)),
  )
  if (taskboardsWithOrphanedEntries.length > 0) {
    issues.push({
      table: 'taskboards',
      description: 'Taskboard entries referencing deleted todos',
      count: taskboardsWithOrphanedEntries.reduce(
        (n, t) => n + t.entries.filter((e) => !todoIds.has(e.todoId)).length,
        0,
      ),
      ids: taskboardsWithOrphanedEntries.map((t) => t.id!),
      fix: 'clear-field',
      field: 'entries',
    })
  }

  const floatingTaskboardsWithBadCanvas = floatingTaskboards.filter(
    (t) => !canvasIds.has(t.canvasId),
  )
  if (floatingTaskboardsWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingTaskboards',
      description: 'Floating taskboards referencing deleted canvases',
      count: floatingTaskboardsWithBadCanvas.length,
      ids: floatingTaskboardsWithBadCanvas.map((t) => t.id!),
      fix: 'delete',
    })
  }

  // --- Dangling foreign keys on entities ---

  const todosWithBadProject = todos.filter(
    (t) => t.projectId != null && !projectIds.has(t.projectId),
  )
  if (todosWithBadProject.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Todos referencing deleted projects',
      count: todosWithBadProject.length,
      ids: todosWithBadProject.map((t) => t.id!),
      fix: 'clear-field',
      field: 'projectId',
    })
  }

  const todosWithBadCanvas = todos.filter(
    (t) => t.canvasId != null && !canvasIds.has(t.canvasId),
  )
  if (todosWithBadCanvas.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Todos referencing deleted canvases',
      count: todosWithBadCanvas.length,
      ids: todosWithBadCanvas.map((t) => t.id!),
      fix: 'clear-field',
      field: 'canvasId',
    })
  }

  const todosWithBadStatus = todos.filter(
    (t) => t.statusId != null && !statusIds.has(t.statusId),
  )
  if (todosWithBadStatus.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Todos referencing deleted statuses',
      count: todosWithBadStatus.length,
      ids: todosWithBadStatus.map((t) => t.id!),
      fix: 'clear-field',
      field: 'statusId',
    })
  }

  const projectsWithBadCanvas = projects.filter(
    (p) => p.canvasId != null && !canvasIds.has(p.canvasId),
  )
  if (projectsWithBadCanvas.length > 0) {
    issues.push({
      table: 'projects',
      description: 'Projects referencing deleted canvases',
      count: projectsWithBadCanvas.length,
      ids: projectsWithBadCanvas.map((p) => p.id!),
      fix: 'clear-field',
      field: 'canvasId',
    })
  }

  const listInsetsWithBadCanvas = listInsets.filter(
    (l) => l.canvasId != null && !canvasIds.has(l.canvasId),
  )
  if (listInsetsWithBadCanvas.length > 0) {
    issues.push({
      table: 'listInsets',
      description: 'List insets referencing deleted canvases',
      count: listInsetsWithBadCanvas.length,
      ids: listInsetsWithBadCanvas.map((l) => l.id!),
      fix: 'delete',
    })
  }

  const floatingNotesWithBadCanvas = floatingNotes.filter(
    (n) => !canvasIds.has(n.canvasId),
  )
  if (floatingNotesWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingNotes',
      description: 'Floating notes referencing deleted canvases',
      count: floatingNotesWithBadCanvas.length,
      ids: floatingNotesWithBadCanvas.map((n) => n.id!),
      fix: 'delete',
    })
  }

  const floatingCalendarsWithBadCanvas = floatingCalendars.filter(
    (c) => !canvasIds.has(c.canvasId),
  )
  if (floatingCalendarsWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingCalendars',
      description: 'Floating calendars referencing deleted canvases',
      count: floatingCalendarsWithBadCanvas.length,
      ids: floatingCalendarsWithBadCanvas.map((c) => c.id!),
      fix: 'delete',
    })
  }

  const floatingHorizonsWithBadCanvas = floatingHorizons.filter(
    (h) => !canvasIds.has(h.canvasId),
  )
  if (floatingHorizonsWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingHorizons',
      description: 'Floating horizons referencing deleted canvases',
      count: floatingHorizonsWithBadCanvas.length,
      ids: floatingHorizonsWithBadCanvas.map((h) => h.id!),
      fix: 'delete',
    })
  }

  const floatingStatusWithBadCanvas = floatingStatus.filter(
    (h) => !canvasIds.has(h.canvasId),
  )
  if (floatingStatusWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingStatus',
      description: 'Floating status widgets referencing deleted canvases',
      count: floatingStatusWithBadCanvas.length,
      ids: floatingStatusWithBadCanvas.map((h) => h.id!),
      fix: 'delete',
    })
  }

  const floatingScoreboardWithBadCanvas = floatingScoreboard.filter(
    (h) => !canvasIds.has(h.canvasId),
  )
  if (floatingScoreboardWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingScoreboard',
      description: 'Floating scoreboard widgets referencing deleted canvases',
      count: floatingScoreboardWithBadCanvas.length,
      ids: floatingScoreboardWithBadCanvas.map((h) => h.id!),
      fix: 'delete',
    })
  }

  const floatingSnoozeGraveyardWithBadCanvas = floatingSnoozeGraveyard.filter(
    (h) => !canvasIds.has(h.canvasId),
  )
  if (floatingSnoozeGraveyardWithBadCanvas.length > 0) {
    issues.push({
      table: 'floatingSnoozeGraveyard',
      description: 'Floating snooze graveyard widgets referencing deleted canvases',
      count: floatingSnoozeGraveyardWithBadCanvas.length,
      ids: floatingSnoozeGraveyardWithBadCanvas.map((h) => h.id!),
      fix: 'delete',
    })
  }

  // --- Unplaced tasks: on a canvas but not in any project (invisible in canvas view) ---

  const unplacedTasks = todos.filter(
    (t) => t.canvasId != null && t.projectId == null,
  )
  if (unplacedTasks.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Tasks not assigned to any project (invisible on canvas)',
      count: unplacedTasks.length,
      ids: unplacedTasks.map((t) => t.id!),
      fix: 'clear-field',
      field: 'canvasId',
    })
  }

  return {
    issues,
    totalOrphans: issues.reduce((sum, i) => sum + i.count, 0),
    scannedAt: new Date(),
  }
}

/** Clean up all issues found by auditData. */
export async function cleanupIssues(issues: AuditIssue[]): Promise<number> {
  let cleaned = 0

  // drop-store issues bypass Dexie — unknown stores aren't in the registered
  // schema, so `db.table(name)` would throw. Use raw IDB transactions.
  for (const issue of issues) {
    if (issue.fix !== 'drop-store') continue
    await rawClear(db.backendDB(), issue.table)
    cleaned += issue.count
  }

  await db.transaction('rw', db.tables, async () => {
    // Taskboards need a special per-row entry filter rather than a blind field-clear.
    const todoIds = new Set((await db.todos.toArray()).map((t) => t.id!))
    for (const issue of issues) {
      if (issue.fix === 'drop-store') continue
      if (issue.fix === 'delete') {
        const table = db.table(issue.table)
        if (issue.keys && issue.keys.length > 0) {
          await table.bulkDelete(issue.keys)
        } else {
          await table.bulkDelete(issue.ids)
        }
        cleaned += issue.count
      } else if (issue.table === 'taskboards' && issue.field === 'entries') {
        for (const id of issue.ids) {
          const row = await db.taskboards.get(id)
          if (!row) continue
          const filtered = row.entries.filter((e) => todoIds.has(e.todoId))
          await db.taskboards.update(id, { entries: filtered, updatedAt: new Date() })
        }
        cleaned += issue.count
      } else if (issue.fix === 'clear-field' && issue.field) {
        const table = db.table(issue.table)
        for (const id of issue.ids) {
          await table.update(id, { [issue.field]: undefined })
        }
        cleaned += issue.count
      }
    }
  })
  return cleaned
}
