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
    todos, projects, canvases, people, tags, orgs,
    todoPeople, todoTags, todoOrgs, personOrgs, taskboardEntries,
    listInsets, stickyNotes,
  ] = await Promise.all([
    db.todos.toArray(),
    db.projects.toArray(),
    db.canvases.toArray(),
    db.people.toArray(),
    db.tags.toArray(),
    db.orgs.toArray(),
    db.todoPeople.toArray(),
    db.todoTags.toArray(),
    db.todoOrgs.toArray(),
    db.personOrgs.toArray(),
    db.taskboardEntries.toArray(),
    db.listInsets.toArray(),
    db.stickyNotes.toArray(),
  ])

  const todoIds = new Set(todos.map((t) => t.id!))
  const projectIds = new Set(projects.map((p) => p.id!))
  const canvasIds = new Set(canvases.map((c) => c.id!))
  const personIds = new Set(people.map((p) => p.id!))
  const tagIds = new Set(tags.map((t) => t.id!))
  const orgIds = new Set(orgs.map((o) => o.id!))

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

  const orphanedTaskboard = taskboardEntries.filter(
    (r) => !todoIds.has(r.todoId),
  )
  if (orphanedTaskboard.length > 0) {
    issues.push({
      table: 'taskboardEntries',
      description: 'Taskboard entries referencing deleted todos',
      count: orphanedTaskboard.length,
      ids: orphanedTaskboard.map((r) => r.id!),
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

  const todosWithBadParent = todos.filter(
    (t) => t.parentId != null && !todoIds.has(t.parentId),
  )
  if (todosWithBadParent.length > 0) {
    issues.push({
      table: 'todos',
      description: 'Todos referencing deleted parent todos',
      count: todosWithBadParent.length,
      ids: todosWithBadParent.map((t) => t.id!),
      fix: 'clear-field',
      field: 'parentId',
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

  const stickyNotesWithBadCanvas = stickyNotes.filter(
    (s) => s.canvasId != null && !canvasIds.has(s.canvasId),
  )
  if (stickyNotesWithBadCanvas.length > 0) {
    issues.push({
      table: 'stickyNotes',
      description: 'Sticky notes referencing deleted canvases',
      count: stickyNotesWithBadCanvas.length,
      ids: stickyNotesWithBadCanvas.map((s) => s.id!),
      fix: 'delete',
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
    [db.todos, db.projects, db.todoPeople, db.todoTags, db.todoOrgs,
     db.personOrgs, db.taskboardEntries, db.listInsets, db.stickyNotes],
    async () => {
      for (const issue of issues) {
        if (issue.fix === 'delete') {
          const table = db.table(issue.table)
          await table.bulkDelete(issue.ids)
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
