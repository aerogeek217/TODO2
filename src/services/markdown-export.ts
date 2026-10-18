import { buildExportData } from '../data/export-data'
import type { PersistedTodoItem } from '../models'
import { bySortOrder } from '../utils/sort-order'
import { startOfToday } from '../utils/date'
import { formatTaskLine, taskLineParts } from './task-copy'

/**
 * Builds a markdown representation of all tasks (in manual order).
 * Uses buildExportData() to read from the repository layer.
 */
export async function buildMarkdownExport(): Promise<string> {
  const data = await buildExportData()
  const allTodos = data.todos as PersistedTodoItem[]

  const peopleMap = new Map(data.people.map((p) => [p.id!, p.name]))
  const tagMap = new Map(data.tags.map((t) => [t.id!, t.name]))
  const statusMap = new Map(data.statuses.map((s) => [s.id!, s]))

  const namesByTodo = (rows: readonly { todoId: number; id: number }[], names: ReadonlyMap<number, string>) => {
    const out = new Map<number, string[]>()
    for (const r of rows) {
      const name = names.get(r.id)
      if (!name) continue
      const list = out.get(r.todoId) ?? []
      list.push(name)
      out.set(r.todoId, list)
    }
    return out
  }
  const todoPeopleMap = namesByTodo(data.todoPeople.map((r) => ({ todoId: r.todoId, id: r.personId })), peopleMap)
  const todoTagsMap = namesByTodo(data.todoTags.map((r) => ({ todoId: r.todoId, id: r.tagId })), tagMap)

  const lines: string[] = ['# TODOs', '']
  const details: string[] = []
  const today = startOfToday()

  // The task line rich copy uses, as a Markdown list item. Unlike rich
  // copy, the export has always named only statuses with an icon; people
  // and tags go to the details section below instead of the line.
  const formatTodoLine = (todo: PersistedTodoItem) => {
    const status = todo.statusId ? statusMap.get(todo.statusId) : undefined
    return `- ${formatTaskLine(taskLineParts(todo, status?.icon ? status : undefined, today))}`
  }

  const collectDetails = (todo: PersistedTodoItem) => {
    const people = todoPeopleMap.get(todo.id) ?? []
    const tags = todoTagsMap.get(todo.id) ?? []
    const hasMeta = people.length > 0 || tags.length > 0 || todo.notes
    if (!hasMeta) return
    details.push(`### ${todo.title}`)
    if (people.length > 0) details.push(`- **People:** ${people.join(', ')}`)
    if (tags.length > 0) details.push(`- **Tags:** ${tags.join(', ')}`)
    if (todo.notes) details.push(`- **Notes:** ${todo.notes}`)
    details.push('')
  }

  for (const todo of [...allTodos].sort(bySortOrder)) {
    lines.push(formatTodoLine(todo))
    collectDetails(todo)
  }
  lines.push('')

  // Append details section
  if (details.length > 0) {
    lines.push('---', '', '# Task Details', '', ...details)
  }

  return lines.join('\n')
}
