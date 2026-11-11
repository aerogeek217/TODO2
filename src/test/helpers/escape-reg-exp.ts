/**
 * `text` as a pattern that matches it literally: every regex metacharacter
 * escaped, the backslash among them. For a test that builds a `RegExp` around
 * a name or a URL (`new RegExp(`^${escapeRegExp(name)}`)`) — never a
 * hand-picked character list, which leaves the rest of them live.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}
