/**
 * `s` on one line: every whitespace run (line breaks, tabs, no-break spaces)
 * becomes one space, and the ends are trimmed.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Control characters, line / paragraph separators, and the bidi embeddings, overrides, isolates and marks. */
const CONTROL_OR_BIDI = /[\p{Cc}\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u

/**
 * `s` as one plain line (a name from a file, shown in a header, menu or
 * tooltip): control characters and line breaks become spaces, bidi controls
 * go (they can make a name read as something else), the ends are trimmed.
 * Other spacing, emoji joiners and the length are kept.
 */
export function plainLine(s: string): string {
  return s.replace(CONTROL_OR_BIDI, (c) => (BIDI.test(c) ? '' : ' ')).trim()
}

/** `s` cut to `max` characters with an ellipsis, for an undo entry's name, a prompt or a dialog's subline. */
export function shortTitle(s: string, max = 40): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * `s` as its leading whitespace, the rest, and its trailing whitespace
 * (all-space text is all lead). By `trimStart` / `trimEnd` lengths, not an
 * `^(\s*)(.*?)(\s*)$` regex — that backtracks quadratically on a long space
 * run before a non-space (cr31 L2).
 */
export function splitEdgeSpace(s: string): { lead: string; core: string; trail: string } {
  const start = s.length - s.trimStart().length
  if (start === s.length) return { lead: s, core: '', trail: '' }
  const end = s.trimEnd().length
  return { lead: s.slice(0, start), core: s.slice(start, end), trail: s.slice(end) }
}
