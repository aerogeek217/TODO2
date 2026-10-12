/**
 * Rich-text export of a flat todo list for clipboard paste into
 * OneNote / Word / Gmail. Mirrors `copyNotesRich` in
 * `services/notes-export.ts` — writes both `text/html` and `text/plain`
 * through `ClipboardItem`, falls back to plain-text `writeText`.
 *
 * The helper renders what it's given: callers pre-filter (e.g. completed
 * tasks) and pre-group. A single flat list is a one-section call
 * with no label; a grouped view passes one section per heading.
 */
import type { PersistedTodoItem, Person, Status } from '../models'
import { startOfToday } from '../utils/date'
import { formatFollowupDate } from '../utils/followup'

export interface CopyTaskSection {
  label?: string
  todos: PersistedTodoItem[]
}

export interface CopyTaskContext {
  assignedPeopleMap: Map<number, Person[]>
  statusMap: Map<number, Status>
  today?: Date
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface TodoDetails {
  check: string
  title: string
  statusStr: string
  deadline: string
  followup: string
  peopleStr: string
}

function todoDetails(
  todo: PersistedTodoItem,
  ctx: CopyTaskContext,
  today: Date,
): TodoDetails {
  const check = todo.isCompleted ? '[x]' : '[ ]'
  const status = todo.statusId ? ctx.statusMap.get(todo.statusId) : undefined
  const statusStr = status ? ` [${status.name}]` : ''
  const deadline = todo.dueDate ? ` (due ${new Date(todo.dueDate).toLocaleDateString()})` : ''
  const followup = todo.nextFollowupAt ? ` (follow-up ${formatFollowupDate(todo.nextFollowupAt, today)})` : ''
  const people = ctx.assignedPeopleMap.get(todo.id) ?? []
  const peopleStr = people.length > 0 ? ` @${people.map((p) => p.name).join(', @')}` : ''
  return { check, title: todo.title, statusStr, deadline, followup, peopleStr }
}

function renderPlainLine(d: TodoDetails): string {
  return `${d.check} ${d.title}${d.statusStr}${d.deadline}${d.followup}${d.peopleStr}`
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

/** Wraps copied HTML in the body font Office / mail clients paste nicely. */
export function wrapClipboardHtml(body: string): string {
  return `<div style="font-family: Calibri, 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.45;">${body}</div>`
}

/**
 * Writes rich HTML + plain text to the clipboard. Returns true on success.
 * Falls back to plain-text-only when `ClipboardItem` is unavailable or
 * rejects (older browsers, insecure contexts).
 */
export async function writeRichClipboard(html: string, plain: string): Promise<boolean> {
  try {
    const ClipItem = (globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (!ClipItem) throw new Error('ClipboardItem unsupported')
    const item = new ClipItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return true
  } catch {
    try {
      await navigator.clipboard.writeText(plain)
      return true
    } catch {
      return false
    }
  }
}

/** Copy the rendered task list to the clipboard as rich HTML + plain text. Returns true on success. */
export async function copyTasksRich(
  sections: CopyTaskSection[],
  ctx: CopyTaskContext,
): Promise<boolean> {
  return writeRichClipboard(wrapClipboardHtml(buildTasksHtml(sections, ctx)), buildTasksPlain(sections, ctx))
}
