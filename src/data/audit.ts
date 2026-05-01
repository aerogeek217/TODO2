import { db } from './database'
import {
  KNOWN_DB_TABLES,
  KNOWN_TABLE_KEYS,
  validateRow,
  isKnownSettingKey,
} from './import-validation'

export interface AuditSample {
  /** The full offending record. JSON-serialised verbatim in the detail popup. */
  row: Record<string, unknown>
  /**
   * The row's primary key — numeric `id` for most tables, string `key` for
   * settings, undefined when the source row has no stable identity (sample
   * pulled from an unknown store with no key path).
   */
  id?: number | string
  /**
   * Field names whose value triggered the issue. The detail popup highlights
   * these to point the eye at the broken column without forcing the user to
   * eyeball the whole record. Examples: the FK column whose target was
   * deleted (`todoId` for an orphaned join), the dangling-FK field that the
   * cleanup will null out, or the bad field reported by `validateRow`.
   */
  badFields?: string[]
  /** Plain-English context shown above the JSON, e.g. "todoId 999 not in todos". */
  note?: string
}

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
  /**
   * Up to `MAX_SAMPLES_PER_ISSUE` of the offending rows for the detail popup.
   * Capped to keep the in-memory report light when an unknown table holds
   * thousands of rows. The full `count` still drives cleanup.
   */
  samples?: AuditSample[]
}

/**
 * Cap on per-issue sample collection. The popup shows "N of M" when truncated.
 * 25 fits comfortably in the dialog without paging and bounds report size.
 */
export const MAX_SAMPLES_PER_ISSUE = 25

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

/**
 * Pull up to `limit` rows from an IDB object store via raw IDB. The audit's
 * unknown-store detection runs before Dexie has registered the store, so we
 * cannot use `db.table(name).limit(...)` here.
 */
function rawSample(idb: IDBDatabase, name: string, limit: number): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const tx = idb.transaction([name], 'readonly')
    const req = tx.objectStore(name).getAll(null, limit)
    req.onsuccess = () => resolve(req.result as unknown[])
    req.onerror = () => reject(req.error)
  })
}

/**
 * Strip Dexie/IDB internals from the row before handing it to the popup so
 * the JSON view shows the same shape the user authored. We don't have any
 * such fields today, but this is the choke point if we ever do.
 */
function toSampleRow(row: unknown): Record<string, unknown> {
  if (row !== null && typeof row === 'object') return { ...(row as Record<string, unknown>) }
  return { value: row }
}

/**
 * Map an FK column on a join row to the table it points at, for the popup's
 * "todoId 999 not in todos" hover note.
 */
function joinTargetTable(field: string): string {
  switch (field) {
    case 'todoId': return 'todos'
    case 'personId': return 'people'
    case 'orgId': return 'orgs'
    case 'tagId': return 'tags'
    case 'canvasId': return 'canvases'
    case 'projectId': return 'projects'
    case 'statusId': return 'statuses'
    default: return field
  }
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
    const sampleRows = await rawSample(idb, name, MAX_SAMPLES_PER_ISSUE)
    issues.push({
      table: name,
      description: `Unknown table "${name}" — drop the entire store`,
      count,
      ids: [],
      fix: 'drop-store',
      field: '__store__',
      samples: sampleRows.map((r) => {
        const row = toSampleRow(r)
        const id = typeof row.id === 'number' || typeof row.id === 'string' ? row.id : undefined
        return { row, id, note: `Row in unregistered store "${name}"` }
      }),
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
    const badSamples: AuditSample[] = []
    for (const row of rows) {
      const result = validateRow(tableKey, row)
      if (result === true) continue
      const id = (row as { id?: number }).id
      if (typeof id !== 'number') continue
      badIds.push(id)
      if (badSamples.length < MAX_SAMPLES_PER_ISSUE) {
        // `validateRow` returns the bad field name (or a short phrase like
        // "key (unrecognized)") on failure. Strip the parenthetical so the
        // popup can highlight the field name reliably.
        const badField = result.replace(/\s*\(.*\)$/, '').trim()
        badSamples.push({
          row: toSampleRow(row),
          id,
          badFields: badField ? [badField] : [],
          note: `Schema validator rejected this row: ${result}`,
        })
      }
    }
    if (badIds.length > 0) {
      issues.push({
        table: tableKey,
        description: `Rows in "${tableKey}" that the current schema cannot read`,
        count: badIds.length,
        ids: badIds,
        fix: 'delete',
        samples: badSamples,
      })
    }
  }

  // --- Unknown setting keys ---
  const unknownSettings = settingsRows.filter((s) => !isKnownSettingKey(s.key))
  if (unknownSettings.length > 0) {
    issues.push({
      table: 'settings',
      description: 'Unrecognized settings — no UI will read or write them',
      count: unknownSettings.length,
      ids: [],
      keys: unknownSettings.map((s) => s.key),
      fix: 'delete',
      samples: unknownSettings.slice(0, MAX_SAMPLES_PER_ISSUE).map((s) => ({
        row: { key: s.key, value: s.value },
        id: s.key,
        badFields: ['key'],
        note: `"${s.key}" is not a setting any code in this build reads or writes`,
      })),
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

  // Helper: build a sample for an orphan-join row, naming which FK is missing.
  const joinSample = (row: Record<string, unknown>, checks: { field: string; valid: boolean }[]): AuditSample => {
    const missing = checks.filter((c) => !c.valid).map((c) => c.field)
    const note = missing
      .map((f) => `${f} ${String(row[f])} not in ${joinTargetTable(f)}`)
      .join(' • ')
    return {
      row: toSampleRow(row),
      id: typeof row.id === 'number' ? (row.id as number) : undefined,
      badFields: missing,
      note,
    }
  }

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
      samples: orphanedTodoPeople.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) =>
        joinSample(r as unknown as Record<string, unknown>, [
          { field: 'todoId', valid: todoIds.has(r.todoId) },
          { field: 'personId', valid: personIds.has(r.personId) },
        ]),
      ),
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
      samples: orphanedTodoOrgs.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) =>
        joinSample(r as unknown as Record<string, unknown>, [
          { field: 'todoId', valid: todoIds.has(r.todoId) },
          { field: 'orgId', valid: orgIds.has(r.orgId) },
        ]),
      ),
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
      samples: orphanedPersonOrgs.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) =>
        joinSample(r as unknown as Record<string, unknown>, [
          { field: 'personId', valid: personIds.has(r.personId) },
          { field: 'orgId', valid: orgIds.has(r.orgId) },
        ]),
      ),
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
      samples: orphanedTodoTags.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) =>
        joinSample(r as unknown as Record<string, unknown>, [
          { field: 'todoId', valid: todoIds.has(r.todoId) },
          { field: 'tagId', valid: tagIds.has(r.tagId) },
        ]),
      ),
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
      samples: orphanedTodoEvents.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) =>
        joinSample(r as unknown as Record<string, unknown>, [
          { field: 'todoId', valid: todoIds.has(r.todoId) },
        ]),
      ),
    })
  }

  // Entries inside each taskboard pointing at deleted todos are reported per-board
  // (fix: 'clear-field' writes back a filtered entries list).
  const taskboardsWithOrphanedEntries = taskboards.filter((t) =>
    t.entries.some((e) => !todoIds.has(e.todoId)),
  )
  if (taskboardsWithOrphanedEntries.length > 0) {
    // Sample shape is one row per offending entry (not per board) so the popup
    // can show the actual stale `todoId` rather than the surrounding board.
    const taskboardSamples: AuditSample[] = []
    for (const board of taskboardsWithOrphanedEntries) {
      for (const entry of board.entries) {
        if (todoIds.has(entry.todoId)) continue
        if (taskboardSamples.length >= MAX_SAMPLES_PER_ISSUE) break
        taskboardSamples.push({
          row: { taskboardId: board.id, ...toSampleRow(entry) },
          id: board.id,
          badFields: ['todoId'],
          note: `todoId ${entry.todoId} not in todos (board #${board.id})`,
        })
      }
      if (taskboardSamples.length >= MAX_SAMPLES_PER_ISSUE) break
    }
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
      samples: taskboardSamples,
    })
  }

  // Helper: sample a row whose single FK column points at a deleted entity.
  // The popup highlights the dangling field and notes the missing target.
  const fkSample = (
    rows: { id?: number }[],
    field: string,
  ): AuditSample[] =>
    rows.slice(0, MAX_SAMPLES_PER_ISSUE).map((r) => {
      const obj = r as unknown as Record<string, unknown>
      return {
        row: toSampleRow(obj),
        id: typeof obj.id === 'number' ? (obj.id as number) : undefined,
        badFields: [field],
        note: `${field} ${String(obj[field])} not in ${joinTargetTable(field)}`,
      }
    })

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
      samples: fkSample(floatingTaskboardsWithBadCanvas, 'canvasId'),
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
      samples: fkSample(todosWithBadProject, 'projectId'),
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
      samples: fkSample(todosWithBadCanvas, 'canvasId'),
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
      samples: fkSample(todosWithBadStatus, 'statusId'),
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
      samples: fkSample(projectsWithBadCanvas, 'canvasId'),
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
      samples: fkSample(listInsetsWithBadCanvas, 'canvasId'),
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
      samples: fkSample(floatingNotesWithBadCanvas, 'canvasId'),
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
      samples: fkSample(floatingCalendarsWithBadCanvas, 'canvasId'),
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
      samples: fkSample(floatingHorizonsWithBadCanvas, 'canvasId'),
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
      samples: fkSample(floatingStatusWithBadCanvas, 'canvasId'),
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
      samples: fkSample(floatingScoreboardWithBadCanvas, 'canvasId'),
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
      samples: fkSample(floatingSnoozeGraveyardWithBadCanvas, 'canvasId'),
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
      samples: unplacedTasks.slice(0, MAX_SAMPLES_PER_ISSUE).map((t) => ({
        row: toSampleRow(t as unknown as Record<string, unknown>),
        id: t.id,
        badFields: ['canvasId', 'projectId'],
        note: 'Has canvasId but no projectId — the canvas view filters tasks by project, so this row is invisible there',
      })),
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
