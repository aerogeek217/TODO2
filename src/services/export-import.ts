import { db } from '../data/database'
import type { PersistedTodoItem } from '../models'
import { bySortOrder } from '../utils/sort-order'
import { scheduledLabel } from '../utils/effective-date'
import { startOfToday } from '../utils/date'

/**
 * Reads all database tables and returns a plain object suitable for
 * JSON serialization (export, file-storage save, or backup snapshot).
 */
export async function buildExportData() {
  const [todos, projects, canvases, listInsets, people, settings, todoPeople, todoOrgs, personOrgs, orgs, taskboards, floatingTaskboards, statuses, listDefinitions, notes, floatingCalendars, floatingNotes] =
    await Promise.all([
      db.todos.toArray(), db.projects.toArray(), db.canvases.toArray(), db.listInsets.toArray(),
      db.people.toArray(), db.settings.toArray(),
      db.todoPeople.toArray(), db.todoOrgs.toArray(), db.personOrgs.toArray(), db.orgs.toArray(),
      db.taskboards.toArray(), db.floatingTaskboards.toArray(),
      db.statuses.toArray(), db.listDefinitions.toArray(), db.notes.toArray(),
      db.floatingCalendars.toArray(), db.floatingNotes.toArray(),
    ])

  return { todos, projects, canvases, listInsets, people, settings, todoPeople, todoOrgs, personOrgs, orgs, taskboards, floatingTaskboards, statuses, listDefinitions, notes, floatingCalendars, floatingNotes }
}

/**
 * Builds a markdown representation of all tasks, grouped by project.
 * Uses buildExportData() to read from the repository layer.
 */
export async function buildMarkdownExport(): Promise<string> {
  const data = await buildExportData()
  const allTodos = data.todos as PersistedTodoItem[]

  const peopleMap = new Map(data.people.map((p) => [p.id!, p.name]))
  const statusMap = new Map(data.statuses.map((s) => [s.id!, s]))

  const todoPeopleMap = new Map<number, string[]>()
  for (const tp of data.todoPeople) {
    const name = peopleMap.get(tp.personId)
    if (name) {
      const list = todoPeopleMap.get(tp.todoId) ?? []
      list.push(name)
      todoPeopleMap.set(tp.todoId, list)
    }
  }

  // Group todos by project
  const byProject = new Map<number | undefined, PersistedTodoItem[]>()
  for (const todo of allTodos) {
    const key = todo.projectId
    const list = byProject.get(key) ?? []
    list.push(todo)
    byProject.set(key, list)
  }

  const lines: string[] = ['# TODOs', '']
  const details: string[] = []
  const today = startOfToday()

  const formatTodoLine = (todo: PersistedTodoItem) => {
    const check = todo.isCompleted ? '[x]' : '[ ]'
    const sched = todo.scheduledDate ? ` (sched: ${scheduledLabel(todo.scheduledDate, today)})` : ''
    const deadline = todo.dueDate ? ` (deadline ${new Date(todo.dueDate).toLocaleDateString()})` : ''
    const status = todo.statusId ? statusMap.get(todo.statusId) : undefined
    const statusStr = status && (status.icon || status.hideByDefault) ? ` [${status.name}]` : ''
    return `- ${check} ${todo.title}${statusStr}${sched}${deadline}`
  }

  const collectDetails = (todo: PersistedTodoItem) => {
    const people = todoPeopleMap.get(todo.id) ?? []
    const hasMeta = people.length > 0 || todo.notes
    if (!hasMeta) return
    details.push(`### ${todo.title}`)
    if (people.length > 0) details.push(`- **People:** ${people.join(', ')}`)
    if (todo.notes) details.push(`- **Notes:** ${todo.notes}`)
    details.push('')
  }

  const renderGroup = (groupTodos: PersistedTodoItem[]) => {
    for (const todo of [...groupTodos].sort(bySortOrder)) {
      lines.push(formatTodoLine(todo))
      collectDetails(todo)
    }
  }

  // Named projects first
  for (const project of data.projects) {
    const groupTodos = byProject.get(project.id!) ?? [] as PersistedTodoItem[]
    if (groupTodos.length === 0) continue
    lines.push(`## ${project.name}`, '')
    renderGroup(groupTodos)
    lines.push('')
  }

  // Tasks with no project
  const noProject = byProject.get(undefined) ?? []
  if (noProject.length > 0) {
    lines.push('## No Project', '')
    renderGroup(noProject)
    lines.push('')
  }

  // Append details section
  if (details.length > 0) {
    lines.push('---', '', '# Task Details', '', ...details)
  }

  return lines.join('\n')
}
