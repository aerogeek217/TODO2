/**
 * Replaces Markdown links `[text](href)` in one line of text, left to right,
 * with whatever `replace` returns. Matches exactly what
 * `/\[([^\]]+)\]\(([^)]+)\)/g` matches (or `[^\]]*` / `[^)]*` with
 * `allowEmpty`): the text runs to the first `]`, the href to the first `)`.
 *
 * A scanner rather than that regex: the regex retries from every `[`, and
 * each retry scans to the end of the line, so a long run of `[` (or of
 * `[a](` without a `)`) takes quadratic time — seconds for a pasted or
 * imported line of some tens of thousands of characters. Here the next `]`
 * and `)` are remembered between start positions, so the whole line is
 * scanned once.
 */
export function replaceMarkdownLinks(
  s: string,
  replace: (text: string, href: string) => string,
  allowEmpty = false,
): string {
  const min = allowEmpty ? 0 : 1
  let out = ''
  let copied = 0
  // The first `]` / `)` at or after the last position searched from; -1 = none left.
  let close = -2
  let paren = -2
  let open = s.indexOf('[')
  while (open !== -1) {
    if (close !== -1 && close <= open) close = s.indexOf(']', open + 1)
    if (close === -1) break
    if (close - open - 1 >= min && s[close + 1] === '(') {
      const hrefStart = close + 2
      if (paren !== -1 && paren < hrefStart) paren = s.indexOf(')', hrefStart)
      if (paren === -1) break
      if (paren - hrefStart >= min) {
        out += s.slice(copied, open) + replace(s.slice(open + 1, close), s.slice(hrefStart, paren))
        copied = paren + 1
        open = s.indexOf('[', copied)
        continue
      }
    }
    open = s.indexOf('[', open + 1)
  }
  return copied === 0 ? s : out + s.slice(copied)
}
