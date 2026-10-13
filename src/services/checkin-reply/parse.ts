/**
 * Reads a pasted reply to a check-in email (`services/checkin-email/build.ts`)
 * back into one block per task: its ref, whether the Completed box is marked,
 * the Progress text and the Notes.
 *
 * The HTML flavour is read first. It is parsed into an inert document with
 * `DOMParser` — never attached to the page, so nothing in it runs or loads.
 * Each task is a table row ending in a `Ref <token>` cell; its update box is
 * the next table whose first cell reads `Your update`, with one label / value
 * row each for `Completed:`, `Progress:` and `Notes:`. Mail clients restyle
 * the markup freely (Word's `MsoNormal` paragraphs, `<o:p>`, `mso-*` styles,
 * extra wrappers), so only the label cells' text and the row structure are
 * relied on.
 *
 * When the HTML holds no task, the plain-text flavour is read line by line:
 * `>` quote prefixes are dropped, a task starts at its `<n>. <title>  Ref
 * <token>` line (also when wrapped onto two lines), and labels count only
 * after the task's `Your update` line. A label's value is on the same line
 * (after a space or tab) or, when the label stands alone, on the next
 * non-empty line. Notes run until the next task line, a section header
 * (`Overdue` / `Coming up`), the sign-off (`Thanks,`), a stray `Your update`
 * line or the footer — so a note line that is exactly one of those ends the
 * notes early.
 *
 * The footer line `Check-in for <name> · sent <YYYY-MM-DD>` gives the person
 * and the send date. In a thread the newest message is on top, so reading
 * stops at the first footer: tasks below it belong to an older email quoted
 * further down (they would carry stale values). Within what is read, the
 * first block for a ref wins.
 */
import { CHECKIN_LABELS, CHECKIN_META_LABELS, CHECKIN_SECTION_LABELS, CHECKIN_SIGN_OFF } from '../checkin-email/build'
import { TASK_REF_LENGTH } from '../checkin-email/ref'
import { escapeHtml } from '../../utils/html'
import { sanitizeHref } from '../notes-export'

/** Largest paste read (HTML + plain text, in UTF-16 code units). */
export const CHECKIN_REPLY_MAX_CHARS = 2 * 1024 * 1024

export interface CheckinReplyInput {
  /** The `text/html` flavour of the paste, when there is one. */
  html?: string
  /** The `text/plain` flavour of the paste. */
  plain: string
}

export interface CheckinReplyBlock {
  /** The ref as written in the reply (lowercased). */
  ref: string
  /** The task title as written in the reply (shown for refs that match nothing). */
  title?: string
  /** The Completed box: `true` when marked, `false` when left empty; absent without a Completed row. */
  completed?: boolean
  /** The Progress text, whitespace collapsed (`''` when empty); absent without a Progress row. */
  progress?: string
  /**
   * The Notes cell's HTML (HTML replies), cleaned: no scripts, styles,
   * comments, images or attributes other than a sanitized link `href`; Word
   * list paragraphs become `- ` lines. Absent without a Notes row.
   */
  notesHtml?: string
  /** The Notes lines (plain-text replies), `\n`-joined. Absent without a Notes row. */
  notesText?: string
}

export interface ParsedCheckinReply {
  /** The person named in the footer. */
  personName?: string
  /** The footer's send date, `YYYY-MM-DD`. */
  sentDate?: string
  /** One block per ref, in reply order (the first occurrence of each ref). */
  blocks: CheckinReplyBlock[]
  /** Which flavour the blocks came from (`none`: no task was found). */
  source: 'html' | 'plain' | 'none'
  /** Update boxes with no task line above them (its Ref was deleted): ignored. */
  orphanUpdates: number
}

export type ParseCheckinReplyResult =
  | { ok: true; reply: ParsedCheckinReply }
  | { ok: false; error: 'too-large'; limit: number }

interface FlavourResult {
  blocks: CheckinReplyBlock[]
  orphanUpdates: number
  footer: Footer | null
}

interface Footer {
  personName: string
  sentDate: string
}

// ── Shared text helpers ─────────────────────────────────────────────────

/** Collapses every whitespace run (incl. no-break spaces and tabs) to one space and trims. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Longer lines are never task / label / footer lines (keeps every regex cheap). */
const MAX_STRUCTURE_LINE = 2000

const REF_TOKEN = `([A-Za-z0-9]{${TASK_REF_LENGTH},})`
/** `<n>. <title>  Ref <token>` — the ref is the last `Ref` on the line. */
const TASK_LINE = new RegExp(`^(\\d+)\\.\\s+(.*?)\\s+Ref\\s+${REF_TOKEN}$`, 'i')
/** `… Ref <token>` or `Ref <token>` alone: the second half of a wrapped task line. */
const REF_TAIL = new RegExp(`^(?:(.*?)\\s+)?Ref\\s+${REF_TOKEN}$`, 'i')
/** A cell that is just `Ref <token>`. */
const REF_CELL = new RegExp(`^Ref\\s+${REF_TOKEN}$`, 'i')
/** The start of a task title: `<n>. `. */
const NUMBERED = /^\d+\.\s+\S/
/** Greedy name, so the last ` · sent <date>` is the separator. */
const FOOTER = /^Check-in for (.+)\s+[·•\-–—]\s+sent\s+(\d{4}-\d{2}-\d{2})$/i

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  if (y == null || m == null || d == null) return false
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

function matchFooter(line: string): Footer | null {
  if (line.length > MAX_STRUCTURE_LINE || !/^check-in for /i.test(line)) return null
  const m = FOOTER.exec(line)
  const name = m?.[1]?.trim()
  if (!name || !m?.[2] || !isRealDate(m[2])) return null
  return { personName: name, sentDate: m[2] }
}

type Field = 'completed' | 'progress' | 'notes'
const FIELD_ORDER: Field[] = ['completed', 'progress', 'notes']
const FIELD_LABELS: Record<Field, string> = {
  completed: CHECKIN_LABELS.completed.replace(/:$/, '').toLowerCase(),
  progress: CHECKIN_LABELS.progress.replace(/:$/, '').toLowerCase(),
  notes: CHECKIN_LABELS.notes.replace(/:$/, '').toLowerCase(),
}
const UPDATE_HEADER = CHECKIN_LABELS.update.toLowerCase()
const SECTION_HEADERS = new Set(Object.values(CHECKIN_SECTION_LABELS).map((s) => s.toLowerCase()))
const SIGN_OFF = CHECKIN_SIGN_OFF.toLowerCase()
const LABEL_WORDS = FIELD_ORDER.map((f) => FIELD_LABELS[f]).join('|')
/** `Label: value`, `Label` + tab + value, or the label alone (colon optional). */
const LABEL_LINE = new RegExp(`^(${LABEL_WORDS})(?:\\s*:\\s*|\\t\\s*|\\s*$)(.*)$`, 'is')

function fieldOfLabel(text: string): Field | null {
  const label = collapse(text).replace(/\s*:$/, '').toLowerCase()
  return FIELD_ORDER.find((f) => FIELD_LABELS[f] === label) ?? null
}

/** Words that mark the Completed box when typed without the brackets. */
const BARE_DONE = new Set(['x', 'y', 'yes', 'done', 'complete', 'completed', '✓', '✔', '✔️', '☑', '☒', '✅', '*'])
/** Box contents that mean "not done". */
const BOX_NOT_DONE = new Set(['no', 'n'])

/**
 * Whether a Completed value marks the task done: a `[…]` box holding any
 * non-space (`[x]`, `[X]`, `[✓]`), or — with the brackets deleted — a bare
 * `x` / `yes` / `done` / check mark. A bracketed tag of two or more words,
 * such as Outlook's `[Marcus Chen]` comment mark, is ignored.
 */
export function isCompletedMarked(value: string): boolean {
  // The box is a few characters; a long value is read by its start (keeps the regexes cheap).
  const text = collapse(value.slice(0, 200).replace(/\[[^\]\s]+(?:\s+[^\]\s]+)+\]/g, ' '))
  const box = /\[\s*([^\s\]]*)\s*\]/.exec(text)
  if (box) {
    const inner = (box[1] ?? '').toLowerCase()
    return inner !== '' && !BOX_NOT_DONE.has(inner)
  }
  const bare = text.replace(/[[\]]/g, '').replace(/[.!]+$/, '').trim().toLowerCase()
  return BARE_DONE.has(bare)
}

/** The first block per ref wins. */
function dedupe(blocks: CheckinReplyBlock[]): CheckinReplyBlock[] {
  const seen = new Set<string>()
  return blocks.filter((b) => {
    if (seen.has(b.ref)) return false
    seen.add(b.ref)
    return true
  })
}

// ── HTML ────────────────────────────────────────────────────────────────

/** Never part of a reply's text: active, embedded or form content. */
const DROP_ELEMENTS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'title', 'head', 'base',
  'svg', 'math', 'img', 'video', 'audio', 'picture', 'source', 'canvas', 'form', 'input', 'button', 'select', 'textarea',
].join(', ')
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul',
])

/** A node's text with line breaks at `<br>` and block boundaries and a tab after each cell. */
function blockText(root: Node): string {
  const out: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const tag = (node as Element).tagName.toLowerCase()
    if (tag === 'br') {
      out.push('\n')
      return
    }
    const block = BLOCK_TAGS.has(tag)
    if (block) out.push('\n')
    for (const child of Array.from(node.childNodes)) walk(child)
    if (block) out.push('\n')
    else if (tag === 'td' || tag === 'th') out.push('\t')
  }
  walk(root)
  return out.join('')
}

function cellText(cell: Element | undefined): string {
  return cell ? collapse(cell.textContent ?? '') : ''
}

function isUpdateTable(table: HTMLTableElement): boolean {
  const first = table.rows[0]?.cells[0]
  return first !== undefined && cellText(first).toLowerCase() === UPDATE_HEADER
}

/** The ref and title of a task heading row (`<n>. <title>` | `Ref <token>`), or null. */
function taskOfRow(tr: HTMLTableRowElement): { ref: string; title?: string } | null {
  const texts = Array.from(tr.cells).map(cellText)
  let refIdx = texts.length - 1
  while (refIdx >= 0 && texts[refIdx] === '') refIdx--
  const last = texts[refIdx]
  if (last === undefined || last.length > MAX_STRUCTURE_LINE) return null
  const cellRef = REF_CELL.exec(last)
  if (cellRef?.[1]) {
    const title = collapse(texts.slice(0, refIdx).join(' ')).replace(/^\d+\.\s*/, '')
    return { ref: cellRef[1].toLowerCase(), ...(title ? { title } : {}) }
  }
  const joined = collapse(texts.join(' '))
  if (joined.length > MAX_STRUCTURE_LINE) return null
  const whole = TASK_LINE.exec(joined)
  if (whole?.[3]) return { ref: whole[3].toLowerCase(), ...(whole[2] ? { title: whole[2] } : {}) }
  return null
}

/** `https://…safelinks.protection.outlook.com/?url=<encoded>&…` → the wrapped URL. */
function unwrapSafeLink(href: string): string {
  try {
    const url = new URL(href)
    if (!/(^|\.)safelinks\.protection\.outlook\.com$/i.test(url.hostname)) return href
    return url.searchParams.get('url') ?? href
  } catch {
    return href
  }
}

/** A Word list paragraph's marker span (`<span style="mso-list:Ignore">·&nbsp;…</span>`). */
function isListIgnoreSpan(el: Element): boolean {
  return /mso-list\s*:\s*ignore/i.test(el.getAttribute('style') ?? '')
}

/**
 * The Notes cell's content as clean HTML for `htmlToMarkdown`: comments and
 * active / embedded content removed, Word list paragraphs turned into `- `
 * (or `<n>. `) lines, Outlook Safe Links unwrapped, emphasis whitespace moved
 * outside the tags (Word splits runs, and `htmlToMarkdown` trims inside
 * them), and every attribute dropped except a sanitized link `href`.
 */
function cleanNotesCell(cell: Element): string {
  const clone = cell.cloneNode(true) as Element
  const doc = clone.ownerDocument
  clone.querySelectorAll(DROP_ELEMENTS).forEach((n) => n.remove())
  const comments: Node[] = []
  const walker = doc.createTreeWalker(clone, NodeFilter.SHOW_COMMENT)
  while (walker.nextNode()) comments.push(walker.currentNode)
  comments.forEach((n) => n.parentNode?.removeChild(n))

  // Word list paragraphs: the bullet / number lives in an `mso-list:Ignore` span.
  for (const span of Array.from(clone.querySelectorAll('span')).filter(isListIgnoreSpan)) {
    if (!clone.contains(span)) continue
    const marker = collapse(span.textContent ?? '')
    const para = span.closest('p, li')
    span.remove()
    if (para?.tagName.toLowerCase() === 'p') {
      const num = /^(\d+)[.)]$/.exec(marker)
      para.insertBefore(doc.createTextNode(num ? `${num[1]}. ` : '- '), para.firstChild)
    }
  }

  for (const el of Array.from(clone.querySelectorAll('b, strong, i, em'))) {
    const text = el.textContent ?? ''
    if (/^\s/.test(text)) el.before(doc.createTextNode(' '))
    if (/\s$/.test(text)) el.after(doc.createTextNode(' '))
  }

  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    const href = el !== clone && el.tagName.toLowerCase() === 'a' ? el.getAttribute('href') : null
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name)
    if (href != null) el.setAttribute('href', sanitizeHref(unwrapSafeLink(href)))
  }
  return clone.innerHTML
}

/** Reads one update table's label / value rows into `block` (the first row per label wins). */
function readUpdateTable(table: HTMLTableElement, block: CheckinReplyBlock): void {
  const seen = new Set<Field>()
  for (const row of Array.from(table.rows).slice(1)) {
    const cells = Array.from(row.cells)
    const labelCell = cells[0]
    if (!labelCell) continue
    let field = fieldOfLabel(labelCell.textContent ?? '')
    let valueCell: Element | undefined = cells[1]
    let valueText: string | undefined
    if (!field && cells.length === 1) {
      // Label and value in one cell: `Progress: …`.
      const m = LABEL_LINE.exec(collapse(labelCell.textContent ?? ''))
      field = m?.[1] ? fieldOfLabel(m[1]) : null
      valueCell = undefined
      valueText = m?.[2] ?? ''
    }
    if (!field || seen.has(field)) continue
    seen.add(field)
    const text = valueText ?? cellText(valueCell)
    if (field === 'completed') block.completed = isCompletedMarked(text)
    else if (field === 'progress') block.progress = collapse(text)
    else block.notesHtml = valueCell ? cleanNotesCell(valueCell) : escapeHtml(text)
  }
}

/** The first footer line, and the text node holding it when it is one node. */
function findHtmlFooter(doc: Document): { footer: Footer; node: Node | null } | null {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent ?? ''
    if (!/check-in for/i.test(text)) continue
    const footer = matchFooter(collapse(text))
    if (footer) return { footer, node: walker.currentNode }
  }
  for (const line of blockText(doc.body).split('\n')) {
    const footer = matchFooter(collapse(line))
    if (footer) return { footer, node: null }
  }
  return null
}

function parseHtml(html: string): FlavourResult {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript, template, title').forEach((n) => n.remove())
  const found = findHtmlFooter(doc)

  const blocks: CheckinReplyBlock[] = []
  let open: CheckinReplyBlock | null = null
  let orphanUpdates = 0
  // Document order: a task row, then its update table.
  for (const el of Array.from(doc.querySelectorAll('table, tr'))) {
    // Below the first footer: an older email quoted further down the thread.
    if (found?.node && found.node.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) break
    if (el.tagName.toLowerCase() === 'table') {
      if (!isUpdateTable(el as HTMLTableElement)) continue
      if (open) readUpdateTable(el as HTMLTableElement, open)
      else orphanUpdates++
      open = null
      continue
    }
    const owner = el.closest('table')
    if (owner && isUpdateTable(owner)) continue
    const task = taskOfRow(el as HTMLTableRowElement)
    if (!task) continue
    open = { ...task }
    blocks.push(open)
  }
  return { blocks, orphanUpdates, footer: found?.footer ?? null }
}

// ── Plain text ──────────────────────────────────────────────────────────

/** Drops `>` quote prefixes (`> `, `>> `, `> > `). */
function unquote(line: string): string {
  return line.replace(/^(?:[ \t]*>)+[ \t]?/, '')
}

/**
 * A label line inside an update box. Only labels after `after` in the box's
 * order count, so a line that merely starts with a label word is read as
 * text of the field before it.
 */
function matchLabelLine(line: string, after: Field | null): { field: Field; value: string } | null {
  const trimmed = line.trim()
  if (trimmed.length > MAX_STRUCTURE_LINE) return null
  const m = LABEL_LINE.exec(trimmed)
  const field = m?.[1] ? fieldOfLabel(m[1]) : null
  if (!field) return null
  if (after && FIELD_ORDER.indexOf(field) <= FIELD_ORDER.indexOf(after)) return null
  return { field, value: m?.[2] ?? '' }
}

function trimBlankEnds(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim() === '') start++
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--
  return lines.slice(start, end)
}

/** A task line at `lines[i]`, possibly wrapped onto the next non-blank line; `next` = the first line after it. */
function taskLineAt(lines: readonly string[], i: number): { ref: string; title: string; next: number } | null {
  const text = collapse(lines[i] ?? '')
  if (text.length > MAX_STRUCTURE_LINE) return null
  const one = /\bref\b/i.test(text) ? TASK_LINE.exec(text) : null
  if (one?.[3]) return { ref: one[3].toLowerCase(), title: one[2] ?? '', next: i + 1 }
  if (!NUMBERED.test(text)) return null
  const title = text.replace(/^\d+\.\s*/, '')
  // `4. A long title that wraps` / `onto here  Ref 9e8d7c6b` on the next line.
  const nextText = collapse(lines[i + 1] ?? '')
  if (nextText !== '') {
    if (nextText.length > MAX_STRUCTURE_LINE || NUMBERED.test(nextText)) return null
    const tail = REF_TAIL.exec(nextText)
    return tail?.[2] ? { ref: tail[2].toLowerCase(), title: collapse(`${title} ${tail[1] ?? ''}`), next: i + 2 } : null
  }
  // The Ref cell on its own line, after a blank one (a table converted to text).
  const cellText = collapse(lines[i + 2] ?? '')
  const cell = cellText.length <= MAX_STRUCTURE_LINE ? REF_CELL.exec(cellText) : null
  return cell?.[1] ? { ref: cell[1].toLowerCase(), title, next: i + 3 } : null
}

const META_LINE = new RegExp(`^(?:${Object.values(CHECKIN_META_LABELS).join('|')}) `)

/** A blank line, a task's meta line or a title line left without its Ref. */
function isHeadingResidue(line: string): boolean {
  const text = collapse(line)
  return text === '' || (text.length <= MAX_STRUCTURE_LINE && (META_LINE.test(text) || NUMBERED.test(text)))
}

function parsePlain(plain: string): FlavourResult {
  const lines = plain.replace(/\r\n?/g, '\n').split('\n').map((l) => unquote(l).trimEnd())
  const blocks: CheckinReplyBlock[] = []
  let footer: Footer | null = null
  let orphanUpdates = 0

  let block: CheckinReplyBlock | null = null
  /** `head`: task line read, before `Your update`; `update`: reading labels; `skip`: an orphan box. */
  let mode: 'none' | 'head' | 'update' | 'skip' = 'none'
  let field: Field | null = null
  /** The current label stood alone: its value is the next non-empty line. */
  let awaitingValue = false
  /** Progress is still taking wrapped continuation lines. */
  let progressOpen = false
  let notes: string[] | null = null

  const close = () => {
    if (block && notes) block.notesText = trimBlankEnds(notes).join('\n')
    block = null
    mode = 'none'
    field = null
    awaitingValue = false
    progressOpen = false
    notes = null
  }
  const setValue = (f: Field, value: string) => {
    if (!block) return
    if (f === 'completed') block.completed = isCompletedMarked(value)
    else if (f === 'progress') block.progress = collapse(value)
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const text = collapse(line)
    const lower = text.toLowerCase()

    // The footer ends the newest email; anything below is an older one quoted in the thread.
    footer = matchFooter(text)
    if (footer) break
    const task = taskLineAt(lines, i)
    if (task) {
      close()
      block = { ref: task.ref, ...(task.title ? { title: task.title } : {}) }
      blocks.push(block)
      mode = 'head'
      i = task.next
      continue
    }
    i++
    if (SECTION_HEADERS.has(lower) || lower === SIGN_OFF) {
      close()
      continue
    }
    if (lower === UPDATE_HEADER) {
      if (mode === 'head') {
        mode = 'update'
      } else {
        // A second box under one task line: its Ref line was deleted. The
        // deleted task's title / meta lines above it aren't the notes' lines.
        if (notes) {
          while (notes.length > 0 && isHeadingResidue(notes.at(-1) ?? '')) notes.pop()
        }
        if (mode !== 'none') close()
        orphanUpdates++
        mode = 'skip'
      }
      continue
    }
    if (mode !== 'update') continue

    if (notes) {
      notes.push(line)
      continue
    }
    const label = matchLabelLine(line, field)
    if (label) {
      field = label.field
      progressOpen = false
      awaitingValue = false
      const value = label.value.trim()
      if (label.field === 'notes') {
        notes = value ? [value] : []
      } else {
        setValue(label.field, value)
        awaitingValue = value === ''
        progressOpen = value !== '' && label.field === 'progress'
      }
      continue
    }
    if (awaitingValue && field) {
      if (text) {
        setValue(field, text)
        awaitingValue = false
        progressOpen = field === 'progress'
      }
      continue
    }
    if (progressOpen && block) {
      if (text) block.progress = collapse(`${block.progress ?? ''} ${text}`)
      else progressOpen = false
    }
  }
  close()
  return { blocks, orphanUpdates, footer }
}

// ── Entry point ─────────────────────────────────────────────────────────

/**
 * Reads a pasted check-in reply (HTML flavour first, plain text when the
 * HTML holds no task). Returns `too-large` without reading anything when the
 * paste is over `CHECKIN_REPLY_MAX_CHARS`.
 */
export function parseCheckinReply(input: CheckinReplyInput): ParseCheckinReplyResult {
  const html = input.html ?? ''
  if (html.length + input.plain.length > CHECKIN_REPLY_MAX_CHARS) {
    return { ok: false, error: 'too-large', limit: CHECKIN_REPLY_MAX_CHARS }
  }
  const fromHtml = html.trim() !== '' && typeof DOMParser !== 'undefined' ? parseHtml(html) : null
  const useHtml = fromHtml !== null && fromHtml.blocks.length > 0
  const fromPlain = useHtml && fromHtml.footer ? null : parsePlain(input.plain)
  const used = useHtml ? fromHtml : fromPlain
  const footer = fromHtml?.footer ?? fromPlain?.footer ?? null
  const blocks = dedupe(used?.blocks ?? [])
  return {
    ok: true,
    reply: {
      ...(footer ? { personName: footer.personName, sentDate: footer.sentDate } : {}),
      blocks,
      source: blocks.length === 0 ? 'none' : useHtml ? 'html' : 'plain',
      orphanUpdates: used?.orphanUpdates ?? 0,
    },
  }
}
