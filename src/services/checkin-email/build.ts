/**
 * The check-in email: subject, HTML body and plain-text body for one person.
 *
 * The HTML is email-safe (tables and inline styles only, no classes, no
 * images) so it survives a paste into new and classic Outlook. The plain text
 * carries the same labels so a plain-text reply can be read back too.
 *
 * Reading a reply back depends on the shape of both bodies:
 * - each task starts on one line / one table row: `<n>. <title>` then
 *   `Ref <token>`;
 * - its update box starts with a line (HTML: a table whose first cell) that is
 *   exactly `Your update`, followed by `Completed:` (`[ ]`), `Progress:` and —
 *   when notes are included — `Notes:`, always in that order;
 * - section headers are exactly `Overdue` and `Coming up`;
 * - the sign-off is `Thanks,` and the last line is
 *   `Check-in for <person name> · sent <YYYY-MM-DD>` (local send date).
 *
 * The task's status is never part of the email.
 */
import type { Person, PersistedTodoItem, Tag } from '../../models'
import { startOfDay, toDateInputValue } from '../../utils/date'
import { daysUntil } from '../../utils/effective-date'
import { escapeHtml } from '../../utils/html'
import { mdToHtml } from '../notes-export'
import { taskRef } from './ref'
import type { CheckinSections } from './select'
import { collapseWhitespace } from '../../utils/text'

export interface CheckinEmailContext {
  /** Today (only the day is used): overdue days and "Today" labels. */
  today: Date
  /** People per task id ("Also assigned"). */
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  /** Tags per task id. */
  assignedTagsMap?: ReadonlyMap<number, readonly Tag[]>
  /**
   * The ref printed for a task uid. Defaults to `taskRef`; pass
   * `createTaskRefLookup` over every task's uid so refs stay unique.
   */
  refOf?: (uid: string) => string
}

export interface CheckinEmailOptions {
  /** Include each task's Notes row (off: notes can't be edited by reply). */
  includeNotes: boolean
  /** List the task's other assignees ("Also assigned"). */
  includeOthers: boolean
  /** When the email is made; its local date goes in the footer. */
  sentAt: Date
}

export interface CheckinEmail {
  /** The person's email address ('' when they have none). */
  to: string
  subject: string
  /** The body as email-safe HTML (a fragment: one wrapping `<div>`). */
  html: string
  /** The body as plain text (`\n` line endings). */
  plain: string
}

/** The section header texts (exact; a reply reader relies on them). */
export const CHECKIN_SECTION_LABELS = { overdue: 'Overdue', comingUp: 'Coming up' } as const

/** The update box's header and labels (exact; a reply reader relies on them). */
export const CHECKIN_LABELS = {
  update: 'Your update',
  completed: 'Completed:',
  progress: 'Progress:',
  notes: 'Notes:',
} as const

/** The labels of a task's meta line (`Due … · Next follow-up … · Tags … · Also assigned …`). */
export const CHECKIN_META_LABELS = {
  due: 'Due',
  nextFollowup: 'Next follow-up',
  tags: 'Tags',
  alsoAssigned: 'Also assigned',
} as const

/** The empty Completed box. */
export const CHECKIN_COMPLETED_BOX = '[ ]'

/** The sign-off line (exact; a reply reader stops a task's notes at it). */
export const CHECKIN_SIGN_OFF = 'Thanks,'

/** `Check-in for <name> · sent <YYYY-MM-DD>` — the footer line a reply reader parses. */
export function checkinFooterLine(personName: string, sentAt: Date): string {
  return `Check-in for ${collapseWhitespace(personName)} · sent ${toDateInputValue(sentAt)}`
}

/** `Task check-in: 3 open tasks` / `Task check-in: 1 open task`. */
export function checkinSubject(taskCount: number): string {
  return `Task check-in: ${taskCount} open task${taskCount === 1 ? '' : 's'}`
}

/**
 * The greeting name: the first word of the person's name, or the whole name
 * when the first word is a prefix ending in a colon (`Org: Northwind`).
 */
export function checkinFirstName(name: string): string {
  const full = collapseWhitespace(name)
  const first = full.split(' ')[0] ?? ''
  return first === '' || first.endsWith(':') ? full : first
}

/** `Thu, Oct 8` (`, 2027` when not this year), or `Today`. */
function formatEmailDay(date: Date, today: Date): string {
  const d = startOfDay(new Date(date))
  if (d.getTime() === startOfDay(today).getTime()) return 'Today'
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
}

interface MetaItem {
  label: string
  value: string
  /** Overdue due date: shown in red. */
  alert?: boolean
}

interface TaskView {
  num: number
  title: string
  ref: string
  meta: MetaItem[]
  progress: string
  notes: string
}

function metaItems(
  todo: PersistedTodoItem,
  person: Person & { id: number },
  ctx: CheckinEmailContext,
  opts: CheckinEmailOptions,
): MetaItem[] {
  const items: MetaItem[] = []
  if (todo.dueDate) {
    const days = daysUntil(todo.dueDate, ctx.today) ?? 0
    const late = -days
    items.push(late > 0
      ? { label: CHECKIN_META_LABELS.due, value: `${formatEmailDay(todo.dueDate, ctx.today)} (${late} day${late === 1 ? '' : 's'} overdue)`, alert: true }
      : { label: CHECKIN_META_LABELS.due, value: formatEmailDay(todo.dueDate, ctx.today) })
  }
  if (todo.nextFollowupAt) items.push({ label: CHECKIN_META_LABELS.nextFollowup, value: formatEmailDay(todo.nextFollowupAt, ctx.today) })
  const tags = ctx.assignedTagsMap?.get(todo.id) ?? []
  if (tags.length > 0) items.push({ label: CHECKIN_META_LABELS.tags, value: tags.map((t) => `#${collapseWhitespace(t.name)}`).join('  ') })
  if (opts.includeOthers) {
    const others = (ctx.assignedPeopleMap.get(todo.id) ?? []).filter((p) => p.id !== person.id)
    if (others.length > 0) items.push({ label: CHECKIN_META_LABELS.alsoAssigned, value: others.map((p) => collapseWhitespace(p.name)).join(', ') })
  }
  return items
}

interface SectionView {
  label: string
  color: string
  tasks: TaskView[]
}

function sectionViews(
  person: Person & { id: number },
  sections: CheckinSections,
  ctx: CheckinEmailContext,
  opts: CheckinEmailOptions,
): SectionView[] {
  const refOf = ctx.refOf ?? taskRef
  let num = 0
  const view = (todo: PersistedTodoItem): TaskView => ({
    num: ++num,
    title: collapseWhitespace(todo.title),
    ref: refOf(todo.uid),
    meta: metaItems(todo, person, ctx, opts),
    progress: collapseWhitespace(todo.progress ?? ''),
    notes: (todo.notes ?? '').replace(/\r\n?/g, '\n').trimEnd(),
  })
  const out: SectionView[] = []
  if (sections.overdue.length > 0) {
    out.push({ label: CHECKIN_SECTION_LABELS.overdue, color: '#b42318', tasks: sections.overdue.map(view) })
  }
  if (sections.comingUp.length > 0) {
    out.push({ label: CHECKIN_SECTION_LABELS.comingUp, color: '#424242', tasks: sections.comingUp.map(view) })
  }
  return out
}

const INTRO = 'Here are the open tasks I have assigned to you. When you get a chance, please'
const NO_TASKS = 'There are no open tasks I have assigned to you right now.'
const HOW_COMPLETED = 'put an x in the box when the task is finished.'
const HOW_TEXT = 'edit the text directly. Leave anything that hasn’t changed as it is.'
const KEEP_REFS = 'Your reply is read back into my task list. Please keep the “Ref” lines and the box labels in your reply.'

// ── HTML ────────────────────────────────────────────────────────────────

const FONT = "font-family: Aptos, Calibri, 'Segoe UI', sans-serif"
const MONO = "font-family: Consolas, 'Courier New', monospace"
const BOX_BORDER = '#c7d7ea'
const P = 'margin: 0 0 12px 0;'
const TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'
const CELL = `padding: 8px 12px; border: 1px solid ${BOX_BORDER}; vertical-align: top;`
const LABEL_CELL = `width="104" style="width: 104px; ${CELL} font-weight: bold;"`
const EMPTY_CELL = '&nbsp;'

/**
 * Notes as HTML: the notes Markdown through `mdToHtml`, with inline margins
 * so mail clients don't space the blocks apart. Every text `mdToHtml` emits
 * is escaped, so its own tags are the only `<p>` / `<ul>` / `<hN>` here.
 */
function notesHtml(notes: string): string {
  if (notes.trim() === '') return EMPTY_CELL
  return mdToHtml(notes)
    .replace(/<p>/g, '<p style="margin: 0;">')
    .replace(/<ul>/g, '<ul style="margin: 0; padding-left: 20px;">')
    .replace(/<h([1-3])>/g, '<h$1 style="margin: 0; font-size: 11pt; font-weight: bold;">')
}

function metaHtml(items: MetaItem[]): string {
  return items
    .map((m) => {
      const label = `<span style="color: #707070; font-weight: normal;">${escapeHtml(m.label)}</span>`
      return m.alert
        ? `<span style="color: #b42318; font-weight: bold;">${label} ${escapeHtml(m.value)}</span>`
        : `<span>${label} ${escapeHtml(m.value)}</span>`
    })
    .join('&nbsp;&nbsp;·&nbsp;&nbsp;')
}

function taskHtml(t: TaskView, includeNotes: boolean): string {
  const rows = [
    `<tr><td colspan="2" style="padding: 6px 12px; border: 1px solid ${BOX_BORDER}; background-color: #ebf3fc; color: #0c3b5e; font-size: 10pt; font-weight: bold;">${CHECKIN_LABELS.update}</td></tr>`,
    `<tr><td ${LABEL_CELL}>${CHECKIN_LABELS.completed}</td><td style="${CELL} ${MONO};">[&nbsp;]</td></tr>`,
    `<tr><td ${LABEL_CELL}>${CHECKIN_LABELS.progress}</td><td style="${CELL}">${t.progress ? escapeHtml(t.progress) : EMPTY_CELL}</td></tr>`,
  ]
  if (includeNotes) {
    rows.push(`<tr><td ${LABEL_CELL}>${CHECKIN_LABELS.notes}</td><td style="${CELL}">${notesHtml(t.notes)}</td></tr>`)
  }
  const head = [
    `<table ${TABLE} style="width: 100%; border-collapse: collapse;">`,
    '<tr>',
    `<td style="padding: 14px 0 4px 0; border-top: 1px solid #e0e0e0; font-size: 12.5pt; font-weight: bold; color: #242424;">${t.num}. ${escapeHtml(t.title)}</td>`,
    `<td width="140" align="right" style="width: 140px; padding: 14px 0 4px 12px; border-top: 1px solid #e0e0e0; ${MONO}; font-size: 9pt; color: #707070; text-align: right; white-space: nowrap;">Ref ${escapeHtml(t.ref)}</td>`,
    '</tr>',
    ...(t.meta.length > 0
      ? [`<tr><td colspan="2" style="padding: 0 0 8px 0; font-size: 10.5pt; color: #424242;">${metaHtml(t.meta)}</td></tr>`]
      : []),
    '</table>',
  ]
  return [
    ...head,
    `<table ${TABLE} style="width: 100%; border-collapse: collapse; margin: 0 0 12px 0; font-size: 11pt;">`,
    ...rows,
    '</table>',
  ].join('\n')
}

function buildHtml(person: Person, sections: SectionView[], opts: CheckinEmailOptions): string {
  const parts: string[] = [`<p style="${P}">Hi ${escapeHtml(checkinFirstName(person.name))},</p>`]
  if (sections.length === 0) {
    parts.push(`<p style="${P}">${NO_TASKS}</p>`)
  } else {
    parts.push(`<p style="${P}">${INTRO} <b>Reply</b> and update the <b>${CHECKIN_LABELS.update}</b> box under each task:</p>`)
    parts.push(
      `<table ${TABLE} style="width: 100%; border-collapse: collapse; margin: 0 0 16px 0;"><tr>`
      + `<td style="padding: 10px 14px; background-color: #f5f5f5; color: #424242; font-size: 10.5pt; line-height: 1.6;">`
      + `<b>Completed:</b> ${HOW_COMPLETED}<br>`
      + `<b>Progress</b> and <b>Notes:</b> ${HOW_TEXT}`
      + '</td></tr></table>',
    )
    for (const s of sections) {
      parts.push(`<p style="margin: 8px 0 4px 0; color: ${s.color}; font-size: 10pt; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase;">${s.label}</p>`)
      for (const t of s.tasks) parts.push(taskHtml(t, opts.includeNotes))
    }
  }
  parts.push(`<p style="margin: 16px 0 12px 0;">${CHECKIN_SIGN_OFF}</p>`)
  parts.push(
    `<p style="margin: 0; font-size: 9pt; color: #707070;">${KEEP_REFS}<br>`
    + `${escapeHtml(checkinFooterLine(person.name, opts.sentAt))}</p>`,
  )
  return `<div style="${FONT}; font-size: 11pt; line-height: 1.45; color: #242424;">\n${parts.join('\n')}\n</div>`
}

// ── Plain text ──────────────────────────────────────────────────────────

function taskPlain(t: TaskView, includeNotes: boolean): string[] {
  const lines = [`${t.num}. ${t.title}  Ref ${t.ref}`]
  if (t.meta.length > 0) lines.push(t.meta.map((m) => `${m.label} ${m.value}`).join(' · '))
  lines.push(
    CHECKIN_LABELS.update,
    `${CHECKIN_LABELS.completed} ${CHECKIN_COMPLETED_BOX}`,
    t.progress ? `${CHECKIN_LABELS.progress} ${t.progress}` : CHECKIN_LABELS.progress,
  )
  if (includeNotes) {
    lines.push(CHECKIN_LABELS.notes)
    if (t.notes.trim() !== '') lines.push(...t.notes.split('\n'))
  }
  return lines
}

function buildPlain(person: Person, sections: SectionView[], opts: CheckinEmailOptions): string {
  const lines: string[] = [`Hi ${checkinFirstName(person.name)},`, '']
  if (sections.length === 0) {
    lines.push(NO_TASKS, '')
  } else {
    lines.push(
      `${INTRO} reply and update the "${CHECKIN_LABELS.update}" box under each task:`,
      '',
      `- Completed: ${HOW_COMPLETED}`,
      `- Progress and Notes: ${HOW_TEXT}`,
      '',
    )
    for (const s of sections) {
      lines.push(s.label, '')
      for (const t of s.tasks) lines.push(...taskPlain(t, opts.includeNotes), '')
    }
  }
  lines.push(CHECKIN_SIGN_OFF, '', KEEP_REFS, checkinFooterLine(person.name, opts.sentAt))
  return lines.join('\n')
}

/**
 * The check-in email for `person` over `sections` (from `selectCheckinTasks`):
 * numbered tasks across the Overdue and Coming up sections, each with its
 * ref, dates, tags, other assignees (when `includeOthers`) and an update box
 * (Completed `[ ]`, Progress, and Notes when `includeNotes`).
 */
export function buildCheckinEmail(
  person: Person & { id: number },
  sections: CheckinSections,
  ctx: CheckinEmailContext,
  opts: CheckinEmailOptions,
): CheckinEmail {
  const views = sectionViews(person, sections, ctx, opts)
  const count = sections.overdue.length + sections.comingUp.length
  return {
    to: person.email ?? '',
    subject: checkinSubject(count),
    html: buildHtml(person, views, opts),
    plain: buildPlain(person, views, opts),
  }
}
