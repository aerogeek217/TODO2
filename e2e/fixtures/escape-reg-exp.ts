/**
 * `text` as a pattern that matches it literally: every regex metacharacter
 * escaped, the backslash among them — never a hand-picked character list,
 * which leaves the rest of them live. (The vitest suite's twin:
 * `src/test/helpers/escape-reg-exp.ts`.)
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}
