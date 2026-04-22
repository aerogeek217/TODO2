import { db } from './database'

export interface AuditIssue {
  table: string
  description: string
  count: number
  /** IDs of rows to delete (join/taskboard orphans) or update (dangling FK) */
  ids: number[]
  fix: 'delete' | 'clear-field'
  field?: string
}

export interface AuditReport {
  issues: AuditIssue[]
  totalOrphans: number
  scannedAt: Date
}

/** Scan all tables for orphaned join rows and dangling foreign keys. */
export async function auditData(): Promise<AuditReport> {
  const [
    todos, projects, canvases, people, orgs, statuses,
    todoPeople, todoOrgs, personOrgs, taskboards,
    listInsets, floatingNotes, floatingCalendars, floatingTaskboards,
  ] = await Promise.all([
    db.todos.toArray(),
    db.projects.toArray(),
    db.canvases.toArray(),
    db.people.toArray(),
    db.orgs.toArray(),
    db.statuses.toArray(),
    db.todoPeople.toArray(),
    db.todoOrgs.toArray(),
    db.personOrgs.toArray(),
    db.taskboards.toArray(),
    db.listInsets.toArray(),
    db.floatingNotes.toArray(),
    db.floatingCalendars.toArray(),
    db.floatingTaskboards.toArray(),
  ])

  const todoIds = new Set(todos.map((t) => t.id!))
  const projectIds = new Set(projects.map((p) => p.id!))
  const canvasIds = new Set(canvases.map((c) => c.id!))
  const personIds = new Set(people.map((p) => p.id!))
  const orgIds = new Set(orgs.map((o) => o.id!))
  const statusIds = new Set(statuses.map((s) => s.id!))

  const issues: AuditIssue[] = []

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
  await db.transaction(
    'rw',
    [db.todos, db.projects, db.todoPeople, db.todoOrgs,
     db.personOrgs, db.taskboards, db.floatingTaskboards, db.listInsets, db.notes,
     db.floatingNotes, db.floatingCalendars, db.statuses],
    async () => {
      // Taskboards need a special per-row entry filter rather than a blind field-clear.
      const todoIds = new Set((await db.todos.toArray()).map((t) => t.id!))
      for (const issue of issues) {
        if (issue.fix === 'delete') {
          const table = db.table(issue.table)
          await table.bulkDelete(issue.ids)
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
    },
  )
  return cleaned
}
