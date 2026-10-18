/**
 * `s` on one line: every whitespace run (line breaks, tabs, no-break spaces)
 * becomes one space, and the ends are trimmed.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}
