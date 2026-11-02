/**
 * Reading the built offline file (`dist/todo2.html`) the way a browser does,
 * for the offline build's checks (`vite.config.offline.ts`): its `<script>`
 * elements, and the CSP hash of an inline script's text.
 *
 * Pure apart from `node:crypto`'s hash, so the vitest suite runs it on
 * fixtures (`src/test/build/offline-file.test.ts`).
 */
import { createHash } from 'node:crypto'

/** A `<script>` element: its start tag and its text, as written in the file. */
export interface ScriptElement {
  tag: string
  text: string
}

/** The file split as the HTML parser splits it. */
export interface HtmlParts {
  /** The document with every comment and every script / style element's text taken out: what the parser reads as markup. */
  markup: string
  /** Every `<script>` element, in order. */
  scripts: ScriptElement[]
}

/** Elements whose text the parser reads raw, up to their own end tag. */
const RAW_TEXT = ['script', 'style'] as const

/**
 * Splits `html` into its markup and its script elements. A script's (or a
 * style's) text runs to the first `</script` (`</style`) after its start
 * tag — the parser ends it there, so the text can't hold one — and a
 * `<script>` written inside that text (the bundle holds a few, as strings)
 * is not an element. A comment runs to the first `-->`.
 */
export function splitHtml(html: string): HtmlParts {
  const lower = html.toLowerCase()
  const scripts: ScriptElement[] = []
  let markup = ''
  let at = 0
  for (;;) {
    const next = nextRawOrComment(lower, at)
    if (!next) break
    if (next.kind === 'comment') {
      markup += html.slice(at, next.start)
      const end = lower.indexOf('-->', next.start + 4)
      at = end < 0 ? html.length : end + 3
      continue
    }
    const tagEnd = html.indexOf('>', next.start)
    if (tagEnd < 0) break
    const tag = html.slice(next.start, tagEnd + 1)
    markup += html.slice(at, tagEnd + 1)
    const close = lower.indexOf(`</${next.kind}`, tagEnd + 1)
    const textEnd = close < 0 ? html.length : close
    if (next.kind === 'script') scripts.push({ tag, text: html.slice(tagEnd + 1, textEnd) })
    at = textEnd
  }
  markup += html.slice(at)
  return { markup, scripts }
}

function nextRawOrComment(lower: string, from: number): { kind: 'comment' | (typeof RAW_TEXT)[number]; start: number } | null {
  let best: { kind: 'comment' | (typeof RAW_TEXT)[number]; start: number } | null = null
  const comment = lower.indexOf('<!--', from)
  if (comment >= 0) best = { kind: 'comment', start: comment }
  for (const name of RAW_TEXT) {
    let start = lower.indexOf(`<${name}`, from)
    // `<scripts…` or `<styled…` is another tag name.
    while (start >= 0 && !/[\s/>]/.test(lower.charAt(start + name.length + 1))) start = lower.indexOf(`<${name}`, start + 1)
    if (start >= 0 && (!best || start < best.start)) best = { kind: name, start }
  }
  return best
}

/**
 * The CSP source (`'sha256-…'`) that allows an inline script holding `text`.
 * The browser hashes the text it parsed, so this does too: the parser turns
 * every CR LF and lone CR into LF and a NUL in script text into U+FFFD.
 */
export function scriptHash(text: string): string {
  const parsed = text.replace(/\r\n?/g, '\n').replace(/\0/g, '�')
  return `'sha256-${createHash('sha256').update(parsed, 'utf8').digest('base64')}'`
}
