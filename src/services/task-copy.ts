/**
 * Rich-text export of a flat todo list for clipboard paste into
 * OneNote / Word / Gmail — `text/html` and `text/plain` through
 * `services/rich-clipboard`, like the notes' rich copy.
 *
 * The helper renders what it's given: callers pre-filter (e.g. completed
 * tasks) and pre-group. A single flat list is a one-section call
 * with no label; a grouped view passes one section per heading.
 * `copyTasks` reads the people / statuses from the stores and says
 * `Copied N tasks`; `copySelectedTasks` is the copy shortcut's (and the
 * palette's) copy of the selected or focused tasks, in display order.
 */
import type { PersistedTodoItem, Person, Status } from '../models'
import { formatDateWith, startOfToday } from '../utils/date'
import { formatFollowupDate } from '../utils/followup'
import { escapeHtml } from '../utils/html'
import { attrSelector, ROW_TODO_ATTR } from '../utils/dom-contract'
import { findScopeElement, orderByRows, readScopeRows } from '../utils/scoped-selection'
import { wrapClipboardHtml, writeRichClipboard } from './rich-clipboard'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTodoStore } from '../stores/todo-store'
import { useUIStore } from '../stores/ui-store'
import { useUndoStore } from '../stores/undo-store'

export interface CopyTaskSection {
  label?: string
  todos: PersistedTodoItem[]
}

export interface CopyTaskContext {
  assignedPeopleMap: Map<number, Person[]>
  statusMap: Map<number, Status>
  today?: Date
}

/**
 * One task as text, the parts rich copy and the Markdown export share:
 * `[ ] title [Status] (due …) (follow-up …)`; each part after the title
 * starts with its space, or is empty.
 */
export interface TaskLineParts {
  check: '[ ]' | '[x]'
  title: string
  statusStr: string
  deadline: string
  followup: string
}

/** `10/21/2026` (`en-US`, whatever the browser's locale). */
const NUMERIC_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' }

/** `status` is the task's status to name (none → no `[Status]`); `today` places the follow-up label. */
export function taskLineParts(
  todo: Pick<PersistedTodoItem, 'isCompleted' | 'title' | 'dueDate' | 'nextFollowupAt'>,
  status: Pick<Status, 'name'> | undefined,
  today: Date,
): TaskLineParts {
  return {
    check: todo.isCompleted ? '[x]' : '[ ]',
    title: todo.title,
    statusStr: status ? ` [${status.name}]` : '',
    deadline: todo.dueDate ? ` (due ${formatDateWith(todo.dueDate, NUMERIC_DATE)})` : '',
    followup: todo.nextFollowupAt ? ` (follow-up ${formatFollowupDate(todo.nextFollowupAt, today)})` : '',
  }
}

/** `[ ] title [Status] (due …) (follow-up …)`. */
export function formatTaskLine(p: TaskLineParts): string {
  return `${p.check} ${p.title}${p.statusStr}${p.deadline}${p.followup}`
}

interface TodoDetails extends TaskLineParts {
  peopleStr: string
}

function todoDetails(
  todo: PersistedTodoItem,
  ctx: CopyTaskContext,
  today: Date,
): TodoDetails {
  const status = todo.statusId ? ctx.statusMap.get(todo.statusId) : undefined
  const people = ctx.assignedPeopleMap.get(todo.id) ?? []
  const peopleStr = people.length > 0 ? ` @${people.map((p) => p.name).join(', @')}` : ''
  return { ...taskLineParts(todo, status, today), peopleStr }
}

function renderPlainLine(d: TodoDetails): string {
  return `${formatTaskLine(d)}${d.peopleStr}`
}

function renderHtmlItem(d: TodoDetails): string {
  const mark = d.check === '[x]' ? '☑' : '☐'
  return `<li>${mark} ${escapeHtml(d.title)}${escapeHtml(d.statusStr + d.deadline + d.followup + d.peopleStr)}</li>`
}

export function buildTasksPlain(sections: CopyTaskSection[], ctx: CopyTaskContext): string {
  const today = ctx.today ?? startOfToday()
  const lines: string[] = []
  for (const section of sections) {
    if (section.todos.length === 0) continue
    if (section.label) lines.push(`== ${section.label} ==`)
    for (const todo of section.todos) {
      lines.push(renderPlainLine(todoDetails(todo, ctx, today)))
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

export function buildTasksHtml(sections: CopyTaskSection[], ctx: CopyTaskContext): string {
  const today = ctx.today ?? startOfToday()
  const parts: string[] = []
  for (const section of sections) {
    if (section.todos.length === 0) continue
    if (section.label) parts.push(`<h2>${escapeHtml(section.label)}</h2>`)
    parts.push('<ul>')
    for (const todo of section.todos) {
      parts.push(renderHtmlItem(todoDetails(todo, ctx, today)))
    }
    parts.push('</ul>')
  }
  return parts.join('\n')
}

/** What the snackbar says when the browser refuses a copy to the clipboard. */
export const COPY_REFUSED_NOTICE = 'Couldn’t copy: the browser didn’t allow access to the clipboard.'

/**
 * Copy the rendered task list to the clipboard as rich HTML + plain text.
 * Returns true on success; a refused copy says so in the snackbar.
 */
export async function copyTasksRich(
  sections: CopyTaskSection[],
  ctx: CopyTaskContext,
): Promise<boolean> {
  const ok = await writeRichClipboard(wrapClipboardHtml(buildTasksHtml(sections, ctx)), buildTasksPlain(sections, ctx))
  if (!ok) useUndoStore.getState().notify(COPY_REFUSED_NOTICE)
  return ok
}

/** `Copied 3 tasks` — what the snackbar says after a copy. */
export function copiedNotice(count: number): string {
  return `Copied ${count} ${count === 1 ? 'task' : 'tasks'}`
}

/** The stores' people and statuses, for a copy. */
function storeCopyContext(): CopyTaskContext {
  return {
    assignedPeopleMap: usePersonStore.getState().assignedPeopleMap,
    statusMap: new Map(useStatusStore.getState().statuses.flatMap((s) => (s.id != null ? [[s.id, s] as const] : []))),
  }
}

/**
 * `copyTasksRich` with the stores' people and statuses, then `Copied N
 * tasks` in the snackbar (N counts each task once). The task menu, a list
 * group's menu, the tab menu's Copy tasks and the copy shortcut use it.
 */
export async function copyTasks(sections: CopyTaskSection[]): Promise<boolean> {
  const ok = await copyTasksRich(sections, storeCopyContext())
  if (ok) {
    const ids = new Set(sections.flatMap((s) => s.todos.map((t) => t.id)))
    useUndoStore.getState().notify(copiedNotice(ids.size))
  }
  return ok
}

/**
 * `todos` in the order the selection's widget shows them (`scope`, read from
 * its rendered rows); with no such widget on screen, as given.
 */
export function inDisplayOrder(todos: readonly PersistedTodoItem[], scope: string | null): PersistedTodoItem[] {
  const el = scope != null ? findScopeElement(scope) : null
  if (!el || todos.length < 2) return [...todos]
  const byId = new Map(todos.map((t) => [t.id, t]))
  return orderByRows(todos.map((t) => t.id), readScopeRows(el)).flatMap((id) => {
    const todo = byId.get(id)
    return todo ? [todo] : []
  })
}

/**
 * The tasks the copy shortcut copies: the selection, in its widget's
 * display order; with nothing selected, the task of the widget row that has
 * the focus. None when neither.
 */
export function tasksToCopy(): PersistedTodoItem[] {
  const ui = useUIStore.getState()
  const todos = useTodoStore.getState().todos
  if (ui.selectedTodoIds.size > 0) {
    return inDisplayOrder(todos.filter((t) => ui.selectedTodoIds.has(t.id)), ui.selectionScope)
  }
  const active = document.activeElement
  const row = active instanceof Element ? active.closest(attrSelector(ROW_TODO_ATTR)) : null
  const id = row ? Number(row.getAttribute(ROW_TODO_ATTR)) : NaN
  const todo = todos.find((t) => t.id === id)
  return todo ? [todo] : []
}

/** Copies the selected (or focused) tasks as one list with no heading; false when there are none. */
export async function copySelectedTasks(): Promise<boolean> {
  const todos = tasksToCopy()
  if (todos.length === 0) return false
  return copyTasks([{ todos }])
}
