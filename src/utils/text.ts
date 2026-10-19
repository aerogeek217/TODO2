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
