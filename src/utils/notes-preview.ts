import { replaceMarkdownLinks } from './markdown-links'
import { collapseWhitespace } from './text'

/** At most this many note lines in a preview; more end in `…`. */
export const NOTES_PREVIEW_MAX_LINES = 6
/** A preview line (and the progress text) is cut to this many characters, ending in `…`. */
export const NOTES_PREVIEW_MAX_CHARS = 80

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/** One Markdown line as plain text: no heading / quote marks, bullets as `•` (done tasks `✓`), no emphasis or code marks, links as their text. */
function plainLine(line: string): string {
  let s = line.trim()
  s = s.replace(/^#{1,6}\s+/, '')
  s = s.replace(/^(?:>\s?)+/, '')
  s = s.replace(/^[-*+]\s+\[[xX]\]\s+/, '✓ ')
  s = s.replace(/^[-*+]\s+\[ \]\s+/, '• ')
  s = s.replace(/^[-*+]\s+/, '• ')
  s = replaceMarkdownLinks(s, (text) => text)
  s = s.replace(/(\*\*|__|~~|`)/g, '')
  s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*\S)\*(?=$|[^\w*])/g, '$1$2')
  return collapseWhitespace(s)
}

/**
 * A line longer than this is cut before its Markdown marks are read: the
 * preview shows {@link NOTES_PREVIEW_MAX_CHARS} of it, and notes have no
 * size limit.
 */
const RAW_LINE_LIMIT = 1000

/**
 * A task's notes (Markdown) as a few plain-text lines for a read-only
 * preview: blank lines and Markdown marks dropped, each line cut to
 * {@link NOTES_PREVIEW_MAX_CHARS}, at most {@link NOTES_PREVIEW_MAX_LINES}
 * lines (the last one `…` when there is more). Reads the note only up to the
 * line after the last one shown — it runs on every row with notes.
 */
export function notesPreviewLines(notes: string | undefined): string[] {
  if (!notes) return []
  const lines: string[] = []
  let from = 0
  while (from <= notes.length && lines.length <= NOTES_PREVIEW_MAX_LINES) {
    const end = notes.indexOf('\n', from)
    const stop = end === -1 ? notes.length : end
    // Skip blank lines without copying them.
    let start = from
    while (start < stop && /\s/.test(notes.charAt(start))) start++
    if (start < stop) {
      const line = plainLine(notes.slice(start, Math.min(stop, start + RAW_LINE_LIMIT)))
      if (line !== '') lines.push(line)
    }
    if (end === -1) break
    from = end + 1
  }
  const shown = lines.slice(0, NOTES_PREVIEW_MAX_LINES).map((l) => clip(l, NOTES_PREVIEW_MAX_CHARS))
  if (lines.length > NOTES_PREVIEW_MAX_LINES) shown[shown.length - 1] = '…'
  return shown
}

/** Whether a task has progress text worth showing (not just spaces). */
export function hasProgressText(progress: string | undefined): boolean {
  return !!progress && progress.trim() !== ''
}

/**
 * The task row notes cell's hover preview: `Progress: <text>` and / or a
 * `Notes` heading over the notes' first lines — as tooltip text, the
 * headings being its label lines. `null` when there is nothing to show.
 */
export function progressNotesPreview(progress: string | undefined, notes: string | undefined): { text: string; labelLines: number } | null {
  const labels: string[] = []
  if (hasProgressText(progress)) labels.push(`Progress: ${clip(collapseWhitespace((progress ?? '').trimStart().slice(0, RAW_LINE_LIMIT)), NOTES_PREVIEW_MAX_CHARS)}`)
  const lines = notesPreviewLines(notes)
  if (lines.length > 0) labels.push('Notes')
  if (labels.length === 0) return null
  return { text: [...labels, ...lines].join('\n'), labelLines: labels.length }
}
