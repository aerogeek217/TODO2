/**
 * Line rules for turning note lines into tasks. Pure: works on the note's
 * text (lines split on `\n`, as CodeMirror's document is), so the toolbar,
 * the Alt+T shortcut and the remove / keep prompt share one definition.
 *
 * - **Batch convert** (the toolbar's Convert) takes bullet lines only:
 *   `- text`, `* text`, `• text`, `[ ] text`, `- [ ] text` (indent ignored).
 *   It skips done boxes (`- [x] text`), lines already converted (`✓ text`),
 *   plain text, headings, blank lines and a bare marker.
 * - **One line** (Alt+T, the editor's hover icon) can be any line with text
 *   that doesn't start with `✓`, list line or not; a leading heading mark,
 *   bullet / dash and box are stripped.
 * - **Subtasks** (cr28): the list lines right under a bullet, indented
 *   deeper than it, are that bullet's task's subtasks (`subtaskLinesUnder`;
 *   a done box a done subtask; plain titles, no parsing) — never candidates
 *   of their own.
 */

import { subtaskTitle } from '../utils/subtasks'

export type NoteLineKind = 'candidate' | 'done' | 'converted' | 'other'

/** A list line's marker within it, spaces after it included: a bullet, an open box or a done box. */
export interface ListMarker {
  from: number
  to: number
  kind: 'bullet' | 'open' | 'done'
}

export interface NoteLine {
  kind: NoteLineKind
  /** Leading whitespace, kept when the line is rewritten as `✓ <title>`. */
  indent: string
  /** The text after the marker and box — what a candidate parses into a task. */
  body: string
}

/** An indented list line under a bullet: a subtask of that bullet's task (its title is plain text). */
export interface SubtaskLine {
  line: number
  text: string
  title: string
  done: boolean
}

/** A line a convert takes: 1-based line number, the full line as it was, its body, and its subtask lines. */
export interface ConvertLine {
  line: number
  text: string
  indent: string
  body: string
  subtasks?: SubtaskLine[]
}

/** The width of a line's indent, a tab as two spaces. */
function indentWidth(text: string): number {
  return (/^[ \t]*/.exec(text)?.[0] ?? '').replace(/\t/g, '  ').length
}

/**
 * The subtask lines right under line `n` (1-based) of `lines`: the lines
 * that follow it indented deeper and are list lines — a bullet or an open
 * box an open subtask, a done box a done subtask. A deeper plain or
 * converted line is left alone (a note line), as is a box with no text; a
 * blank line, or one not indented deeper, ends them. Any deeper indent
 * counts as one level. Titles are as stored (`subtaskTitle`).
 */
export function subtaskLinesUnder(lines: readonly string[], n: number): SubtaskLine[] {
  const parent = lines[n - 1]
  if (parent === undefined) return []
  const parentIndent = indentWidth(parent)
  const out: SubtaskLine[] = []
  for (let k = n + 1; k <= lines.length; k++) {
    const text = lines[k - 1] ?? ''
    if (text.trim() === '' || indentWidth(text) <= parentIndent) break
    const c = classifyNoteLine(text)
    if (c.kind !== 'candidate' && c.kind !== 'done') continue
    // The title as stored: an empty done box makes no subtask (as an empty open box), a long line is cut.
    const title = subtaskTitle(c.body)
    if (title !== '') out.push({ line: k, text, title, done: c.kind === 'done' })
  }
  return out
}

/** `line` with its subtask lines, when it has any. */
function withSubtaskLines(line: ConvertLine, lines: readonly string[]): ConvertLine {
  const subtasks = subtaskLinesUnder(lines, line.line)
  return subtasks.length > 0 ? { ...line, subtasks } : line
}


/** 1-based, inclusive line numbers. */
export interface LineRange {
  from: number
  to: number
}

const CONVERTED_RE = /^✓(\s|$)/
// A bullet, then optionally a box; or a box alone. Whitespace must follow.
const BULLET_RE = /^([-*•])\s+(?:\[([ xX])\](?:\s+|$))?/
const BOX_RE = /^\[([ xX])\](?:\s+|$)/

/** Classifies one note line for the batch convert. */
/** The marker of list line `text` (`- `, `* `, `• `, `- [ ] `, `[ ] `, `- [x] `…), or null when it has none. */
export function listMarker(text: string): ListMarker | null {
  const from = (/^\s*/.exec(text)?.[0] ?? '').length
  const rest = text.slice(from)
  const bullet = BULLET_RE.exec(rest)
  const box = bullet ? null : BOX_RE.exec(rest)
  const match = bullet ?? box
  if (!match) return null
  const mark = bullet ? bullet[2] : box?.[1]
  const kind = mark === undefined ? 'bullet' : mark === ' ' ? 'open' : 'done'
  return { from, to: from + match[0].length, kind }
}

/** What the toolbar's list buttons make a line: a bullet or a box (open or done). */
export type ListKind = 'bullet' | 'box'

const LIST_PREFIX: Record<ListKind, string> = { bullet: '- ', box: '- [ ] ' }

/** The list kind of line `text`, or null when it isn't a list line. */
export function listKindOf(text: string): ListKind | null {
  const marker = listMarker(text)
  if (!marker) return null
  return marker.kind === 'bullet' ? 'bullet' : 'box'
}

/**
 * The change that makes line `text` a `kind` line, or plain text with null:
 * the marker it has goes (indent and text stay). Offsets are within the line.
 */
export function listKindChange(text: string, kind: ListKind | null): TextChange {
  const marker = listMarker(text)
  const from = marker ? marker.from : (/^\s*/.exec(text)?.[0] ?? '').length
  return { from, to: marker ? marker.to : from, insert: kind ? LIST_PREFIX[kind] : '' }
}

export function classifyNoteLine(text: string): NoteLine {
  const indent = /^\s*/.exec(text)?.[0] ?? ''
  const rest = text.slice(indent.length)
  if (CONVERTED_RE.test(rest)) return { kind: 'converted', indent, body: rest.replace(CONVERTED_RE, '').trim() }
  const bullet = BULLET_RE.exec(rest)
  const box = bullet ? null : BOX_RE.exec(rest)
  const match = bullet ?? box
  if (!match) return { kind: 'other', indent, body: rest.trim() }
  const mark = bullet ? bullet[2] : box?.[1]
  const body = rest.slice(match[0].length).trim()
  if (mark === 'x' || mark === 'X') return { kind: 'done', indent, body }
  if (CONVERTED_RE.test(body)) return { kind: 'converted', indent, body: body.replace(CONVERTED_RE, '').trim() }
  if (!body) return { kind: 'other', indent, body }
  return { kind: 'candidate', indent, body }
}

// One line: a leading heading mark, or a bullet or dash then a box (open or done), are stripped.
const SINGLE_PREFIX_RE = /^(?:#{1,6}\s+|(?:[-*•–—]\s+)?(?:\[[ xX]\]\s+)?)/

/**
 * The line Alt+T or the hover icon converts, or null when it can't be (no
 * text, or already converted). Any other line qualifies, list line or not.
 */
export function singleLineCandidate(text: string, line: number): ConvertLine | null {
  const indent = /^\s*/.exec(text)?.[0] ?? ''
  const rest = text.slice(indent.length)
  if (CONVERTED_RE.test(rest)) return null
  const body = rest.replace(SINGLE_PREFIX_RE, '').trim()
  if (!body || CONVERTED_RE.test(body)) return null
  return { line, text, indent, body }
}

/** Offsets where each line of `text` starts. */
export function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/** The 1-based line holding offset `pos`. */
export function lineAt(starts: readonly number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((starts[mid] ?? 0) <= pos) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/**
 * The lines a selection `from`–`to` (offsets) touches, even partly, or null
 * for an empty selection. A selection that ends at the very start of a line
 * (e.g. a whole line selected with its newline) doesn't touch that line.
 */
export function selectionLines(text: string, from: number, to: number): LineRange | null {
  const a = Math.min(from, to)
  const b = Math.max(from, to)
  if (a === b) return null
  const starts = lineStarts(text)
  const first = lineAt(starts, a)
  let last = lineAt(starts, b)
  if (last > first && starts[last - 1] === b) last -= 1
  return { from: first, to: last }
}

/**
 * The bullet lines a batch convert takes: every candidate line of the note,
 * or only those inside `range` (from `selectionLines`), each with the
 * subtask lines under it (those inside the range), which are not
 * candidates of their own.
 */
export function convertCandidates(text: string, range: LineRange | null): ConvertLine[] {
  const lines = text.split('\n')
  const out: ConvertLine[] = []
  const first = range ? Math.max(1, range.from) : 1
  const last = range ? Math.min(lines.length, range.to) : lines.length
  for (let n = first; n <= last; n++) {
    const lineText = lines[n - 1] ?? ''
    const c = classifyNoteLine(lineText)
    if (c.kind !== 'candidate') continue
    const subtasks = subtaskLinesUnder(lines, n).filter((s) => s.line <= last)
    out.push({ line: n, text: lineText, indent: c.indent, body: c.body, ...(subtasks.length > 0 ? { subtasks } : {}) })
    const lastChild = subtasks.at(-1)
    if (lastChild) n = lastChild.line
  }
  return out
}

/** `singleLineCandidate` (Alt+T) for line `n` of `text`, with the subtask lines under it. */
export function singleLineCandidateAt(text: string, n: number): ConvertLine | null {
  const lines = text.split('\n')
  const candidate = singleLineCandidate(lines[n - 1] ?? '', n)
  return candidate ? withSubtaskLines(candidate, lines) : null
}

/**
 * Finds converted lines in the note as it is now (it may have changed since
 * the convert started). Each target is its original line number and text: a
 * line still at that number with the same text is used; otherwise the
 * nearest unclaimed line with exactly that text (earlier one on a tie). A
 * line that can't be found — edited or deleted — gives null and is left
 * alone. Returns 1-based line numbers, one per target.
 */
export function locateLines(text: string, targets: readonly { line: number; text: string }[]): (number | null)[] {
  const lines = text.split('\n')
  const claimed = new Set<number>()
  const found: (number | null)[] = targets.map(() => null)
  targets.forEach((t, i) => {
    if (lines[t.line - 1] === t.text && !claimed.has(t.line)) {
      claimed.add(t.line)
      found[i] = t.line
    }
  })
  targets.forEach((t, i) => {
    if (found[i] != null) return
    let best: number | null = null
    for (let n = 1; n <= lines.length; n++) {
      if (claimed.has(n) || lines[n - 1] !== t.text) continue
      if (best == null || Math.abs(n - t.line) < Math.abs(best - t.line)) best = n
    }
    if (best != null) {
      claimed.add(best)
      found[i] = best
    }
  })
  return found
}

export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * Changes that delete the given lines (1-based) with their newlines. Runs of
 * adjacent lines become one change, so the result never overlaps and can be
 * dispatched as one CodeMirror transaction.
 */
export function removeLineChanges(text: string, lineNumbers: readonly number[]): TextChange[] {
  const starts = lineStarts(text)
  const total = starts.length
  const sorted = [...new Set(lineNumbers)].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  const lineEnd = (n: number) => (n < total ? (starts[n] ?? text.length) - 1 : text.length)
  const changes: TextChange[] = []
  let i = 0
  while (i < sorted.length) {
    const first = sorted[i] ?? 1
    let last = first
    while (sorted[i + 1] === last + 1) { i++; last += 1 }
    i++
    const from = starts[first - 1] ?? 0
    if (last < total) {
      changes.push({ from, to: (starts[last] ?? text.length), insert: '' })
    } else {
      // The run reaches the end: take the newline before it instead.
      changes.push({ from: first > 1 ? from - 1 : 0, to: lineEnd(last), insert: '' })
    }
  }
  return changes
}

/** Changes that rewrite each given line (1-based) as `<indent>✓ <title>`. */
export function markLineChanges(text: string, items: readonly { line: number; title: string }[]): TextChange[] {
  const starts = lineStarts(text)
  const lines = text.split('\n')
  const seen = new Set<number>()
  const changes: TextChange[] = []
  for (const { line, title } of [...items].sort((a, b) => a.line - b.line)) {
    if (line < 1 || line > lines.length || seen.has(line)) continue
    seen.add(line)
    const lineText = lines[line - 1] ?? ''
    const from = starts[line - 1] ?? 0
    const indent = /^\s*/.exec(lineText)?.[0] ?? ''
    changes.push({ from, to: from + lineText.length, insert: `${indent}✓ ${title}` })
  }
  return changes
}

/** Applies non-overlapping changes to `text` (for tests and non-editor writes). */
export function applyTextChanges(text: string, changes: readonly TextChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  }
  return out
}
