/**
 * Compares a parsed check-in reply (`parse.ts`) with the tasks' current
 * values and proposes the changes the import dialog lists for the user to
 * confirm. Nothing is stored about what was sent, so a change is simply a
 * reply value that differs from the task's value now.
 *
 * - **Completed:** a marked box on an open task → complete it. An unmarked
 *   box proposes nothing; a reply never reopens a task.
 * - **Progress:** one line (whitespace collapsed, capped like the editor),
 *   compared with the current progress. An empty reply value never clears it.
 * - **Notes:** the reply's notes replace the task's notes. Both sides are
 *   compared line by line on their visible text (the current notes go
 *   through the same `mdToHtml` → `htmlToMarkdown` path the email and reply
 *   took), so reformatting by the mail client alone proposes nothing. When
 *   they differ, the new notes keep the original Markdown of every unchanged
 *   line and use the reply's text only for added / edited lines; the line
 *   diff (`=` / `-` / `+`) is returned for display. Emptied notes are a
 *   change that starts unticked (an accidental delete is likelier).
 * - A task modified in the app on a later day than the email's send date is
 *   `stale`: all its changes start unticked. A task completed since the email
 *   is listed with no changes. Refs that match no task (or several) are
 *   returned as `unmatched` — a deleted task is one of those.
 */
import type { PersistedTodoItem } from '../../models'
import { toDateInputValue } from '../../utils/date'
import { replaceMarkdownLinks } from '../../utils/markdown-links'
import { resolveTaskRef } from '../checkin-email/ref'
import { htmlToMarkdown, mdToHtml } from '../notes-export'
import type { CheckinReplyBlock, ParsedCheckinReply } from './parse'

/** Progress is one line of at most this many characters (as in the task editor). */
export const CHECKIN_PROGRESS_MAX = 500

/** Above this many line pairs, the notes diff skips the LCS (keeps huge pastes fast). */
const LCS_MAX_CELLS = 250_000

export interface NotesDiffLine {
  /** `=` unchanged, `-` removed, `+` added. */
  op: '=' | '-' | '+'
  /** The line as it reads in the old (`=` / `-`) or new (`+`) notes. */
  text: string
}

export type CheckinChange =
  | {
    field: 'completed'
    /** Ticked when the dialog opens. */
    defaultSelected: boolean
  }
  | {
    field: 'progress'
    from: string
    to: string
    defaultSelected: boolean
  }
  | {
    field: 'notes'
    from: string
    /** The new notes (Markdown): applying replaces the task's notes with this. */
    to: string
    /** The line diff, in order. */
    lines: NotesDiffLine[]
    /** The reply's Notes cell was emptied (the task had notes). */
    emptied: boolean
    defaultSelected: boolean
  }

export interface CheckinTaskDiff {
  /** The ref as written in the reply. */
  ref: string
  todo: PersistedTodoItem
  /** Completed in the app since the email: listed, with no changes. */
  completedSinceSent: boolean
  /** Modified in the app on a later day than the email was sent: its changes start unticked. */
  stale: boolean
  changes: CheckinChange[]
}

export interface CheckinUnmatchedRef {
  ref: string
  /** The task title as written in the reply, when there was one. */
  title?: string
  /** `not-found`: no task (e.g. deleted since the email); `ambiguous`: several tasks share the ref. */
  reason: 'not-found' | 'ambiguous'
}

export interface CheckinReplyDiff {
  /** The footer's person name. */
  personName?: string
  /** The footer's send date, `YYYY-MM-DD`. */
  sentDate?: string
  /** One entry per matched task, in reply order. */
  tasks: CheckinTaskDiff[]
  unmatched: CheckinUnmatchedRef[]
  /** Reply blocks read (matched or not). */
  blockCount: number
  /** Changes over all tasks (ticked or not). */
  changeCount: number
  /** Tasks flagged `stale`. */
  staleCount: number
}

export interface CheckinDiffContext {
  /** Every task (completed ones too), to match refs against. */
  todos: readonly PersistedTodoItem[]
}

// ── Notes lines ─────────────────────────────────────────────────────────

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Checkbox glyphs `mdToHtml` prints (and mail clients keep) back to Markdown. */
function fixCheckbox(line: string): string {
  return line
    .replace(/^(?:[-*•·]\s+)?☐\s*/, '- [ ] ')
    .replace(/^(?:[-*•·]\s+)?[☑☒]\s*/, '- [x] ')
}

/**
 * A reply notes line as Markdown: whitespace collapsed, a `•` / `·` bullet
 * (Word's plain text) as `- `, checkbox glyphs as `- [ ]` / `- [x]`.
 */
function replyLine(line: string): string {
  return fixCheckbox(collapse(line).replace(/^[•·▪◦]\s+/, '- '))
}

/**
 * A notes line's comparison key: its visible text — no heading or bullet
 * marker, no emphasis / code marks, links as their text — with whitespace
 * collapsed; a checkbox keeps its state (`[ ] ` / `[x] `).
 */
export function notesLineKey(markdownLine: string): string {
  let s = collapse(markdownLine)
  s = s.replace(/^#{1,6}\s+/, '')
  s = s.replace(/^[-*+•·▪◦]\s+/, '')
  s = s.replace(/^(?:\[\s?\]|☐)\s*/, '[ ] ').replace(/^(?:\[[xX✓✔]\]|[☑☒])\s*/, '[x] ')
  s = replaceMarkdownLinks(s, (text) => text, true)
  s = s.replace(/\*\*|__|[*`]/g, '')
  return collapse(s)
}

/** Separates stored lines in one `htmlToMarkdown` pass (invisible separators + a word: never in real notes). */
const INVISIBLE_SEPARATOR = String.fromCharCode(0x2063)
const LINE_MARK = `${INVISIBLE_SEPARATOR.repeat(2)}line${INVISIBLE_SEPARATOR.repeat(2)}`

/**
 * Stored notes lines as they read after the email → reply round trip
 * (`mdToHtml` → `htmlToMarkdown`), each line on its own (the email renders
 * them as separate blocks). One DOM parse for all lines; per line only if the
 * batch comes back misaligned.
 */
function roundTrip(lines: readonly string[]): string[] {
  const one = (line: string) => collapse(htmlToMarkdown(mdToHtml(line)))
  if (lines.length < 2) return lines.map(one)
  const html = lines.map(mdToHtml).join(`<p>${LINE_MARK}</p>`)
  const parts = htmlToMarkdown(html).split(LINE_MARK).map(collapse)
  return parts.length === lines.length ? parts : lines.map(one)
}

interface KeyedLine {
  text: string
  key: string
  /** Blank lines before it in the stored notes (kept when the line is kept). */
  blanksBefore: number
}

function currentLines(notes: string): KeyedLine[] {
  const kept: { text: string; blanksBefore: number }[] = []
  let blanks = 0
  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      blanks++
      continue
    }
    kept.push({ text: line, blanksBefore: kept.length === 0 ? 0 : blanks })
    blanks = 0
  }
  const trips = roundTrip(kept.map((l) => l.text))
  return kept.map((l, i) => ({ ...l, key: notesLineKey(trips[i] ?? l.text) }))
}

/** The reply's notes as Markdown lines (blank lines dropped: mail clients add and remove them freely). */
export function replyNotesLines(block: Pick<CheckinReplyBlock, 'notesHtml' | 'notesText'>): string[] | null {
  let markdown: string
  if (block.notesHtml !== undefined) markdown = htmlToMarkdown(block.notesHtml)
  else if (block.notesText !== undefined) markdown = block.notesText
  else return null
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(replyLine)
    .filter((l) => l !== '')
}

type Op = { op: '='; a: number; b: number } | { op: '-'; a: number } | { op: '+'; b: number }

/** Line diff of keys `a` → `b`: common prefix / suffix, then an LCS of the middle (or replace-all when huge). */
function diffKeys(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const ops: Op[] = []
  for (let i = 0; i < start; i++) ops.push({ op: '=', a: i, b: i })
  const n = endA - start
  const m = endB - start
  if (n * m > LCS_MAX_CELLS) {
    for (let i = start; i < endA; i++) ops.push({ op: '-', a: i })
    for (let j = start; j < endB; j++) ops.push({ op: '+', b: j })
  } else {
    // lcs[i][j] = LCS length of a[start+i..endA) and b[start+j..endB).
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
      const row = lcs[i] ?? []
      const below = lcs[i + 1] ?? []
      for (let j = m - 1; j >= 0; j--) {
        row[j] = a[start + i] === b[start + j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0)
      }
    }
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        ops.push({ op: '=', a: start + i, b: start + j })
        i++
        j++
      } else if (i < n && (j >= m || (lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0))) {
        // Removed lines before added ones (an edited line reads `-` then `+`).
        ops.push({ op: '-', a: start + i })
        i++
      } else {
        ops.push({ op: '+', b: start + j })
        j++
      }
    }
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ op: '=', a: endA + k, b: endB + k })
  return ops
}

/**
 * The notes change for a reply, or null when the reply's notes read the same
 * as the current ones (or the reply has no Notes row).
 */
export function diffNotes(current: string, reply: readonly string[] | null): Extract<CheckinChange, { field: 'notes' }> | null {
  if (reply === null) return null
  const old = currentLines(current)
  const replyKeys = reply.map(notesLineKey)
  const ops = diffKeys(old.map((l) => l.key), replyKeys)
  if (ops.every((o) => o.op === '=')) return null

  const lines: NotesDiffLine[] = []
  const out: string[] = []
  for (const o of ops) {
    if (o.op === '=') {
      const line = old[o.a]
      if (!line) continue
      if (out.length > 0) for (let k = 0; k < line.blanksBefore; k++) out.push('')
      out.push(line.text)
      lines.push({ op: '=', text: line.text })
    } else if (o.op === '-') {
      lines.push({ op: '-', text: old[o.a]?.text ?? '' })
    } else {
      const text = reply[o.b] ?? ''
      out.push(text)
      lines.push({ op: '+', text })
    }
  }
  const emptied = reply.length === 0 && old.length > 0
  return {
    field: 'notes',
    from: current,
    to: out.join('\n'),
    lines,
    emptied,
    defaultSelected: !emptied,
  }
}

// ── Task diff ───────────────────────────────────────────────────────────

/** The reply's Progress as the task would store it: one line, capped. */
export function replyProgress(value: string): string {
  return collapse(value).slice(0, CHECKIN_PROGRESS_MAX).trim()
}

/** Whether the task was modified on a later (local) day than `sentDate`. */
export function isChangedSince(todo: Pick<PersistedTodoItem, 'modifiedAt'>, sentDate: string | undefined): boolean {
  if (!sentDate) return false
  return toDateInputValue(todo.modifiedAt) > sentDate
}

function blockChanges(todo: PersistedTodoItem, block: CheckinReplyBlock, stale: boolean): CheckinChange[] {
  const changes: CheckinChange[] = []
  const ticked = !stale
  if (block.completed === true) changes.push({ field: 'completed', defaultSelected: ticked })
  if (block.progress !== undefined) {
    const to = replyProgress(block.progress)
    const from = todo.progress ?? ''
    if (to !== '' && to !== collapse(from)) changes.push({ field: 'progress', from, to, defaultSelected: ticked })
  }
  const notes = diffNotes(todo.notes ?? '', replyNotesLines(block))
  if (notes) changes.push({ ...notes, defaultSelected: notes.defaultSelected && ticked })
  return changes
}

/**
 * The changes a parsed reply proposes, per matched task (in reply order),
 * plus the refs that matched nothing. Each task appears once, under the
 * first ref that names it.
 */
export function diffCheckinReply(parsed: ParsedCheckinReply, ctx: CheckinDiffContext): CheckinReplyDiff {
  const tasks: CheckinTaskDiff[] = []
  const unmatched: CheckinUnmatchedRef[] = []
  const seen = new Set<number>()
  for (const block of parsed.blocks) {
    const found = resolveTaskRef(block.ref, ctx.todos)
    if (found.status !== 'found') {
      unmatched.push({ ref: block.ref, ...(block.title ? { title: block.title } : {}), reason: found.status })
      continue
    }
    const todo = found.todo
    if (seen.has(todo.id)) continue
    seen.add(todo.id)
    const stale = isChangedSince(todo, parsed.sentDate)
    if (todo.isCompleted) {
      tasks.push({ ref: block.ref, todo, completedSinceSent: true, stale, changes: [] })
      continue
    }
    tasks.push({ ref: block.ref, todo, completedSinceSent: false, stale, changes: blockChanges(todo, block, stale) })
  }
  return {
    ...(parsed.personName ? { personName: parsed.personName } : {}),
    ...(parsed.sentDate ? { sentDate: parsed.sentDate } : {}),
    tasks,
    unmatched,
    blockCount: parsed.blocks.length,
    changeCount: tasks.reduce((n, t) => n + t.changes.length, 0),
    staleCount: tasks.filter((t) => t.stale && !t.completedSinceSent).length,
  }
}
