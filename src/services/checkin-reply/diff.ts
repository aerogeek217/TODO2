/**
 * Compares a parsed check-in reply (`parse.ts`) with the tasks' current
 * values and proposes the changes the import dialog lists for the user to
 * confirm. Nothing is stored about what was sent, so a change is simply a
 * reply value that differs from the task's value now.
 *
 * - **Completed:** a marked box on an open task → complete it. An unmarked
 *   box proposes nothing; a reply never reopens a task.
 * - **Status:** one line as an entry stores it (`statusUpdateText`), the
 *   email's `(MM/DD)` already dropped (`parse.ts`), compared with the task's
 *   newest status update's text; a different one is a new status update
 *   (`apply.ts` adds it dated today). An empty value, the newest's text left
 *   as it is, or only its date removed proposes nothing — a reply never
 *   removes an entry.
 * - **Notes:** the reply's notes replace the task's notes. Both sides are
 *   compared line by line on their visible text (the current notes go
 *   through the same `mdToHtml` → `htmlToMarkdown` path the email and reply
 *   took), so reformatting by the mail client alone proposes nothing. When
 *   they differ, the new notes keep the original Markdown of every unchanged
 *   line and use the reply's text only for added / edited lines; the line
 *   diff (`=` / `-` / `+`) is returned for display. Emptied notes are a
 *   change that starts unticked (an accidental delete is likelier).
 * - Every other change starts ticked: the dialog's preview shows what each
 *   does to the task as it is now, and the user decides (no timestamps are
 *   compared). A task already completed in the app is listed with no
 *   changes. Refs that match no task (or several) are returned as
 *   `unmatched` — a deleted task is one of those.
 */
import type { PersistedTodoItem, StatusUpdate } from '../../models'
import { replaceMarkdownLinks } from '../../utils/markdown-links'
import { resolveTaskRef } from '../checkin-email/ref'
import { htmlToMarkdown, mdToHtml } from '../notes-export'
import type { CheckinReplyBlock, ParsedCheckinReply } from './parse'
import { statusUpdateText } from '../../utils/status-updates'
import { collapseWhitespace } from '../../utils/text'
import { diffSequences, lcsCells, wordDiff, wordTokens, type WordDiffPart } from '../../utils/word-diff'

/** Above this many line pairs, the notes diff skips the LCS (keeps huge pastes fast). */
const LCS_MAX_CELLS = 250_000

export interface NotesDiffLine {
  /** `=` unchanged, `-` removed, `+` added. */
  op: '=' | '-' | '+'
  /** The line as it reads in the old (`=` / `-`) or new (`+`) notes. */
  text: string
}

/**
 * A notes diff line as the import dialog shows it: a kept / removed / added
 * line, or (`~`) an edited line — a removed line and the added line that
 * replaces it — as one word diff.
 */
export type NotesPreviewLine = NotesDiffLine | { op: '~'; parts: WordDiffPart[] }

export type CheckinChange =
  | {
    field: 'completed'
    /** Ticked when the dialog opens. */
    defaultSelected: boolean
  }
  | {
    field: 'statusUpdate'
    /** The new status update's text (one line): applying adds it, dated today. */
    text: string
    /** The task's newest status update now; absent when it has none. */
    newest?: Pick<StatusUpdate, 'date' | 'text'>
    defaultSelected: boolean
  }
  | {
    field: 'notes'
    from: string
    /** The new notes (Markdown): applying replaces the task's notes with this. */
    to: string
    /** The line diff, in order. */
    lines: NotesDiffLine[]
    /**
     * The line diff is an LCS (false: the notes were too long for one, so
     * every line between the common start and end reads removed, then added
     * — the preview pairs none of them).
     */
    exact: boolean
    /** The reply's Notes cell was emptied (the task had notes). */
    emptied: boolean
    defaultSelected: boolean
  }

export interface CheckinTaskDiff {
  /** The ref as written in the reply. */
  ref: string
  todo: PersistedTodoItem
  /** Already completed in the app: listed, with no changes. */
  alreadyCompleted: boolean
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
  /** The footer's send date, `YYYY-MM-DD` (information only). */
  sentDate?: string
  /** One entry per matched task, in reply order. */
  tasks: CheckinTaskDiff[]
  unmatched: CheckinUnmatchedRef[]
  /** Reply blocks read (matched or not). */
  blockCount: number
  /** Changes over all tasks (ticked or not). */
  changeCount: number
}

export interface CheckinDiffContext {
  /** Every task (completed ones too), to match refs against. */
  todos: readonly PersistedTodoItem[]
  /** Each task's status updates, newest first: the reply's update is compared with the newest's text. */
  statusUpdatesByTodo?: ReadonlyMap<number, readonly StatusUpdate[]>
}

// ── Notes lines ─────────────────────────────────────────────────────────

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
  return fixCheckbox(collapseWhitespace(line).replace(/^[•·▪◦]\s+/, '- '))
}

/**
 * A notes line's comparison key: its visible text — no heading or bullet
 * marker, no emphasis / code marks, links as their text — with whitespace
 * collapsed; a checkbox keeps its state (`[ ] ` / `[x] `).
 */
export function notesLineKey(markdownLine: string): string {
  let s = collapseWhitespace(markdownLine)
  s = s.replace(/^#{1,6}\s+/, '')
  s = s.replace(/^[-*+•·▪◦]\s+/, '')
  s = s.replace(/^(?:\[\s?\]|☐)\s*/, '[ ] ').replace(/^(?:\[[xX✓✔]\]|[☑☒])\s*/, '[x] ')
  s = replaceMarkdownLinks(s, (text) => text, true)
  s = s.replace(/\*\*|__|[*`]/g, '')
  return collapseWhitespace(s)
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
  const one = (line: string) => collapseWhitespace(htmlToMarkdown(mdToHtml(line)))
  if (lines.length < 2) return lines.map(one)
  const html = lines.map(mdToHtml).join(`<p>${LINE_MARK}</p>`)
  const parts = htmlToMarkdown(html).split(LINE_MARK).map(collapseWhitespace)
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

/**
 * The notes change for a reply, or null when the reply's notes read the same
 * as the current ones (or the reply has no Notes row).
 */
export function diffNotes(current: string, reply: readonly string[] | null): Extract<CheckinChange, { field: 'notes' }> | null {
  if (reply === null) return null
  const old = currentLines(current)
  const replyKeys = reply.map(notesLineKey)
  const oldKeys = old.map((l) => l.key)
  const ops = diffSequences(oldKeys, replyKeys, LCS_MAX_CELLS)
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
    exact: lcsCells(oldKeys, replyKeys) <= LCS_MAX_CELLS,
    emptied,
    defaultSelected: !emptied,
  }
}

/** Letter / digit words in `text` (spaces and punctuation left out). */
const countWords = (text: string) => wordTokens(text).filter((t) => /[\p{L}\p{N}]/u.test(t)).length

/** Above this many removed × added lines in one run, the preview pairs none of them. */
const PAIR_MAX_CELLS = 2_500

/**
 * Above this many word-diff token cells over every pair of a run (its removed
 * lines' tokens × its added lines' — what word-diffing each pair costs at
 * most), the preview pairs none of them: each pair's own cap
 * (`WORD_DIFF_MAX_CELLS`) times up to `PAIR_MAX_CELLS` pairs froze the
 * dialog for seconds on long rewritten lines (cr31 L1). A 50-line note of
 * 20-word lines rewritten whole stays under it.
 */
export const PAIR_MAX_TOKEN_CELLS = 5_000_000

const tokenCount = (lines: readonly NotesDiffLine[]) => lines.reduce((n, l) => n + wordTokens(l.text).length, 0)

/**
 * A removed line and an added line as one edited line: their word diff, and
 * how many words it keeps — null when it keeps fewer than half the shorter
 * line's words (or none): two unrelated lines, shown whole.
 */
function editOf(from: string, to: string): { parts: WordDiffPart[]; kept: number } | null {
  const parts = wordDiff(from, to)
  const kept = parts.reduce((n, p) => (p.op === '=' ? n + countWords(p.text) : n), 0)
  const shorter = Math.min(countWords(from), countWords(to))
  return kept > 0 && kept * 2 >= shorter ? { parts, kept } : null
}

/**
 * One run of removed lines followed by added lines, for display: the pairs
 * that keep the most words in all (in order — a pair never crosses another),
 * each an edited line (`~`); the lines left stay whole, removed before added
 * where they meet.
 */
function pairRun(removed: readonly NotesDiffLine[], added: readonly NotesDiffLine[]): NotesPreviewLine[] {
  const n = removed.length
  const m = added.length
  if (n === 0 || m === 0 || n * m > PAIR_MAX_CELLS) return [...removed, ...added]
  if (tokenCount(removed) * tokenCount(added) > PAIR_MAX_TOKEN_CELLS) return [...removed, ...added]
  const edits = removed.map((r) => added.map((a) => editOf(r.text, a.text)))
  // best[i][j]: the most kept words pairing removed[i..] with added[j..].
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const edit = edits[i]?.[j]
      const row = best[i] ?? []
      row[j] = Math.max(
        best[i + 1]?.[j] ?? 0,
        row[j + 1] ?? 0,
        edit ? edit.kept + (best[i + 1]?.[j + 1] ?? 0) : 0,
      )
    }
  }
  const out: NotesPreviewLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const edit = edits[i]?.[j]
    const here = best[i]?.[j] ?? 0
    if (edit && here === edit.kept + (best[i + 1]?.[j + 1] ?? 0)) {
      out.push({ op: '~', parts: edit.parts })
      i++
      j++
    } else if (here === (best[i + 1]?.[j] ?? 0)) {
      out.push(...removed.slice(i, i + 1))
      i++
    } else {
      out.push(...added.slice(j, j + 1))
      j++
    }
  }
  out.push(...removed.slice(i), ...added.slice(j))
  return out
}

/**
 * The notes line diff for display. In each run of removed lines followed by
 * added lines, a removed line and an added line that keep at least half the
 * shorter one's words pair up as one edited line (`~`, word-diffed) — the
 * pairs keeping the most words, in order; every other line stays a whole
 * remove / add. `exact` false (the line diff was too long for an LCS): no
 * pairs at all.
 */
export function notesPreviewLines(lines: readonly NotesDiffLine[], exact = true): NotesPreviewLine[] {
  if (!exact) return [...lines]
  const out: NotesPreviewLine[] = []
  let removed: NotesDiffLine[] = []
  let added: NotesDiffLine[] = []
  const flush = () => {
    out.push(...pairRun(removed, added))
    removed = []
    added = []
  }
  for (const line of lines) {
    if (line.op === '-') {
      // A removed line after added ones starts a new run.
      if (added.length > 0) flush()
      removed.push(line)
    } else if (line.op === '+') {
      added.push(line)
    } else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out
}

// ── Task diff ───────────────────────────────────────────────────────────

/**
 * The status update change for a reply's Status value, or null when it
 * proposes none: empty, or the newest entry's text (compared as stored).
 */
export function diffStatusUpdate(
  value: string | undefined,
  newest: Pick<StatusUpdate, 'date' | 'text'> | undefined,
): Extract<CheckinChange, { field: 'statusUpdate' }> | null {
  if (value === undefined) return null
  const text = statusUpdateText(value)
  if (text === '' || (newest && text === statusUpdateText(newest.text))) return null
  return { field: 'statusUpdate', text, ...(newest ? { newest: { date: newest.date, text: newest.text } } : {}), defaultSelected: true }
}

function blockChanges(todo: PersistedTodoItem, block: CheckinReplyBlock, statusUpdatesByTodo: CheckinDiffContext['statusUpdatesByTodo']): CheckinChange[] {
  const changes: CheckinChange[] = []
  if (block.completed === true) changes.push({ field: 'completed', defaultSelected: true })
  const status = diffStatusUpdate(block.statusUpdate, statusUpdatesByTodo?.get(todo.id)?.at(0))
  if (status) changes.push(status)
  const notes = diffNotes(todo.notes ?? '', replyNotesLines(block))
  if (notes) changes.push(notes)
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
    if (todo.isCompleted) {
      tasks.push({ ref: block.ref, todo, alreadyCompleted: true, changes: [] })
      continue
    }
    tasks.push({ ref: block.ref, todo, alreadyCompleted: false, changes: blockChanges(todo, block, ctx.statusUpdatesByTodo) })
  }
  return {
    ...(parsed.personName ? { personName: parsed.personName } : {}),
    ...(parsed.sentDate ? { sentDate: parsed.sentDate } : {}),
    tasks,
    unmatched,
    blockCount: parsed.blocks.length,
    changeCount: tasks.reduce((n, t) => n + t.changes.length, 0),
  }
}
