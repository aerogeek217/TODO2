import { ALL_DATA_TABLES, CURRENT_DB_VERSION, db } from '../data/database'
import type { SettingRow } from '../data/database'
import { prepareImportText } from '../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from './migration-check'
import type {
  TodoItem, Project, Canvas, Person, ListInset,
  TodoPerson, Taskboard, Status, Note,
  FloatingCalendar, FloatingNote, FloatingTaskboard, FloatingStatus,
  Tag, TodoTag, TodoEvent, PersistedTodoItem, ListOrder,
} from '../models'
import type { ListDefinition } from '../models/list-definition'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { bySortOrder } from '../utils/sort-order'
import { formatFollowupDate } from '../utils/followup'
import { startOfToday } from '../utils/date'

/**
 * Shape of `buildExportData`'s return — every data table by name plus
 * `__schemaVersion`. The interface is the contract for consumers that read
 * named fields (e.g. `buildMarkdownExport`); the runtime body iterates
 * `ALL_DATA_TABLES` so adding a new table to that array auto-flows through
 * export.
 */
export interface ExportData {
  [SCHEMA_VERSION_KEY]: number
  todos: TodoItem[]
  projects: Project[]
  canvases: Canvas[]
  listInsets: ListInset[]
  people: Person[]
  settings: SettingRow[]
  todoPeople: TodoPerson[]
  taskboards: Taskboard[]
  statuses: Status[]
  listDefinitions: ListDefinition[]
  notes: Note[]
  floatingCalendars: FloatingCalendar[]
  floatingNotes: FloatingNote[]
  floatingTaskboards: FloatingTaskboard[]
  floatingStatus: FloatingStatus[]
  tags: Tag[]
  todoTags: TodoTag[]
  todoEvents: TodoEvent[]
  layouts: WorkspaceLayout[]
  listOrders: ListOrder[]
}

/**
 * Reads all database tables and returns a plain object suitable for
 * JSON serialization (export, file-storage save, or backup snapshot).
 *
 * The returned object is stamped with `__schemaVersion = CURRENT_DB_VERSION` so
 * the import path can detect older files without reaching for field-shape
 * heuristics. See `services/migration-check.ts:detectUnsupportedImport`.
 *
 * Iterates `ALL_DATA_TABLES` from `data/database.ts` so the export covers every
 * data table — round-trips through `parseAndRestore` without silent loss.
 *
 * All reads run inside one read-only Dexie transaction over `ALL_DATA_TABLES`,
 * so the export is a consistent snapshot (a concurrent write can't land
 * between two table reads and leave e.g. a join row without its todo).
 */
export async function buildExportData(): Promise<ExportData> {
  const entries = await db.transaction('r', [...ALL_DATA_TABLES], () =>
    Promise.all(
      ALL_DATA_TABLES.map(async (table) => [table.name, await table.toArray()] as const),
    ),
  )
  return {
    [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
    ...Object.fromEntries(entries),
  } as ExportData
}

/**
 * Export self-check: runs the serialized export back through the real import
 * pipeline (`prepareImportText` — version check, upgrade, validation). Returns
 * `null` when the file would import, or the validator's message naming the
 * failing table / row / field when it would not.
 *
 * Takes the JSON string (not the object) so it checks exactly what is written
 * — `Date`s already serialized, `undefined`s already dropped.
 */
export function selfCheckExportJson(json: string): string | null {
  const result = prepareImportText(json)
  return result.ok ? null : result.error
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
    const deadline = todo.dueDate ? ` (due ${new Date(todo.dueDate).toLocaleDateString()})` : ''
    const followup = todo.nextFollowupAt ? ` (follow-up ${formatFollowupDate(todo.nextFollowupAt, today)})` : ''
    const status = todo.statusId ? statusMap.get(todo.statusId) : undefined
    const statusStr = status?.icon ? ` [${status.name}]` : ''
    return `- ${check} ${todo.title}${statusStr}${deadline}${followup}`
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
