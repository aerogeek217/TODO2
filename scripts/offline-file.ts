/**
 * Reading the built offline file (`dist/todo2.html`) the way a browser does,
 * for the offline build's checks (`vite.config.offline.ts`): its `<script>`
 * elements, the CSP hash of an inline script's text, and the egress check
 * (`checkOfflineFile`) — the file makes no network request.
 *
 * Pure apart from `node:crypto`'s hash, so the vitest suite runs it on
 * fixtures (`src/test/build/offline-file.test.ts`) and
 * `e2e/built-csp.spec.ts` on the built file.
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
  const parsed = text.replace(/\r\n?/g, '\n').replace(/\0/g, '\uFFFD')
  return `'sha256-${createHash('sha256').update(parsed, 'utf8').digest('base64')}'`
}

// ---------------------------------------------------------------------------
// The egress check

/** A text in the file that names a URL or a network API but sends nothing, and why it's there. */
export interface InertText {
  text: string
  reason: string
}

/**
 * Every absolute URL the offline file may hold (matched whole), each inert:
 * a name or a message, never fetched. A new one fails the build until it is
 * looked at and added here with its reason.
 */
export const INERT_URLS: readonly InertText[] = [
  { text: 'http://www.w3.org/2000/svg', reason: 'the SVG namespace: React creates SVG elements in it, data: SVG images declare it' },
  { text: 'http://www.w3.org/1998/Math/MathML', reason: 'the MathML namespace (React)' },
  { text: 'http://www.w3.org/1999/xlink', reason: 'the XLink namespace: React sets xlink: attributes in it' },
  { text: 'http://www.w3.org/XML/1998/namespace', reason: 'the XML namespace: React sets xml: attributes in it' },
  { text: 'https://react.dev/errors/', reason: "React's error messages name it (a minified error's decoder page), as text" },
  { text: 'https://reactrouter.com/en/main/routers/picking-a-router', reason: "a React Router error message's link, as text" },
  { text: 'http://localhost', reason: "React Router's base for parsing a path with `new URL` (never fetched)" },
  { text: 'server://singlefetch/', reason: "React Router's parse base off the browser (server rendering), never reached here" },
  { text: 'http://bit.ly/2kdckMn', reason: "a Dexie error message's link, as text" },
  { text: 'https://tinyurl.com/y2uuvskb', reason: "Dexie's missing-IndexedDB message's link, as text" },
  { text: 'https://', reason: "CodeMirror markdown's prefix for a pasted `www.…` link, put in the note's text" },
]

/** URL schemes the file may name in any URL: none the browser can fetch. */
export const INERT_SCHEMES: readonly InertText[] = [
  { text: 'idb', reason: "Dexie's keys for its in-memory query cache (`idb://<db>/<table>`), map keys only" },
]

/**
 * Texts holding a network API's name that call nothing: a hit of
 * `NETWORK_APIS` inside one of them passes.
 */
export const INERT_API_TEXTS: readonly InertText[] = [
  { text: 'Workaround for Chrome UnknownError on open()', reason: "Dexie's console warning (its IndexedDB open), as text" },
  // Resource hints: library code that would add a <link rel=…> if called.
  // Nothing in the app calls it. Each text is written with its function's
  // own locals (e, t, n), not the bundle's top-level names, so an app change
  // doesn't move it. preload / prefetch / modulepreload would also be
  // refused by the CSP (default-src 'none'); preconnect and dns-prefetch
  // would not — hence the check.
  { text: '(`dns-prefetch`,e,null)', reason: "React DOM's ReactDOM.prefetchDNS(): the app never calls it" },
  { text: '(`preconnect`,e,t)', reason: "React DOM's ReactDOM.preconnect(): the app never calls it" },
  { text: 'link[rel="preload"][as="', reason: "React DOM's lookup selector for ReactDOM.preload() and a suspended stylesheet's preload: the app calls none, renders no <link>" },
  { text: 'rel:`preload`,href:t===`image`', reason: "React DOM's ReactDOM.preload(): the app never calls it" },
  { text: 'link[rel="modulepreload"][as="', reason: "React DOM's lookup selector for ReactDOM.preloadModule(): the app never calls it" },
  { text: '{rel:`modulepreload`,href:e},t)', reason: "React DOM's ReactDOM.preloadModule(): the app never calls it" },
  { text: '{rel:`preload`,as:`style`,href:n.href,crossOrigin:n.crossOrigin', reason: "React DOM's preload of a suspended <link rel=stylesheet precedence>: the app renders no <link>" },
  { text: 'e.supports(`modulepreload`)?`modulepreload`:`preload`', reason: "Vite's dynamic-import preload helper: it adds links only for a call's deps, and every call in the single file passes none (void 0 / [])" },
  { text: 'e.rel===`preload`&&typeof e.imageSrcSet==`string`', reason: "React Router's framework-mode <PrefetchPageLinks> / <Links>: the data router renders neither" },
  { text: 'e.rel===`stylesheet`||e.rel===`preload`).map(e=>e.rel===`stylesheet`?{...e,rel:`prefetch`,as:`style`}:{...e,rel:`prefetch`})', reason: "React Router's framework-mode <PrefetchPageLinks>: the data router renders none" },
  { text: '{key:e,rel:`prefetch`,as:`fetch`,href:e,...n}', reason: "React Router's framework-mode <PrefetchPageLinks> (data links): the data router renders none" },
  { text: '{key:e,rel:`modulepreload`,href:e,...n}', reason: "React Router's framework-mode <PrefetchPageLinks> (module links): the data router renders none" },
]

/**
 * What a network request is made with, as it reads in the minified bundle.
 * Call-shaped where the bare name is also a library's own word (React
 * Router's `fetch` is its fetcher API; Dexie calls `db.open()`).
 */
export const NETWORK_APIS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'fetch()', pattern: /\bfetch\s*\(/g },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/g },
  { name: 'WebSocket', pattern: /\bWebSocket\b/g },
  { name: 'EventSource', pattern: /\bEventSource\b/g },
  { name: 'navigator.sendBeacon', pattern: /\bsendBeacon\b/g },
  { name: 'WebRTC', pattern: /\b(?:webkit)?RTC(?:PeerConnection|DataChannel)\b/g },
  { name: 'WebTransport', pattern: /\bWebTransport\b/g },
  { name: 'a worker', pattern: /\bWorker\s*\(|\bSharedWorker\b/g },
  { name: 'a service worker', pattern: /\bserviceWorker\b/g },
  { name: 'importScripts', pattern: /\bimportScripts\b/g },
  // A reference, called or not (`const o=window.open`, `window.open.call(…)`,
  // `window["open"]`); a bare `open(` is the global's call.
  { name: 'window.open', pattern: /\b(?:window|self|globalThis|top|parent|opener)(?:\.open\b|\[\s*["'`]open["'`]\s*\])|(?<![\w$.])open\s*\(/g },
  // The CSP doesn't stop a DNS prefetch or a preconnect. In markup, or a
  // rel value anywhere in script text — quoted as a string however it is
  // set (`l.rel="preconnect"`, `setAttribute("rel",…)`, a helper's argument).
  { name: 'a resource hint', pattern: /\brel\s*=\s*\\?["'`]?\s*(?:preconnect|dns-prefetch|prefetch|prerender|modulepreload|preload)\b/gi },
  { name: 'a resource hint', pattern: /["'`](?:preconnect|dns-prefetch|prefetch|prerender|modulepreload|preload)["'`]/gi },
  { name: "React DOM's resource hints", pattern: /\.(?:preconnect|prefetchDNS)\s*\(/g },
  { name: 'speculation rules', pattern: /speculationrules/gi },
]

/** An absolute URL (any scheme with `//`), up to a quote, a bracket, a backslash or a space. */
const ABSOLUTE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`<>()\\]*/gi
/**
 * A protocol-relative `//host…` — a dotted name, one without a dot (a UNC
 * `//fileserver/share`: an SMB request on file://) or a bracketed IPv6 —
 * not part of an absolute URL or a regex's escaped slashes; a bare `"//"`
 * names no host.
 */
const RELATIVE_URL = /(?<![\w:/\\])\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])[^\s"'`<>()\\]*/gi
/** A data: URL's base64 payload: random letters, where `//` and API names turn up by chance. */
const BASE64_PAYLOAD = /(;base64,)[A-Za-z0-9+/=]+/g

/** Elements the file's markup must not hold: each loads or sends something. */
const LOADING_ELEMENTS = /<(base|iframe|frame|object|embed|img|picture|source|audio|video|track|form|a|area|portal)\b[^>]*>/gi

/**
 * What the offline file does that could reach the network — or `[]`: the
 * egress check, run by the offline build on its finished file. It holds one
 * inline script and nothing that loads (no `<link>` but its data: icons);
 * its CSP comes first, denies by default, names no 'self', host or scheme
 * but data: / blob:, and allows the script by its hash; it sends no
 * Referer; and neither markup nor code holds a network API
 * (`NETWORK_APIS`) or a URL outside `INERT_URLS`.
 */
export function checkOfflineFile(html: string): string[] {
  const problems: string[] = []
  const { markup, scripts } = splitHtml(html)

  const [script, ...more] = scripts
  if (!script || more.length > 0) problems.push(`holds ${scripts.length} <script> elements, not one`)
  for (const s of scripts) if (/\ssrc\s*=/i.test(s.tag)) problems.push(`loads a script: ${s.tag}`)

  problems.push(...checkCsp(markup, script))
  if (!/<meta name="referrer" content="no-referrer"\s*\/?>/.test(markup)) problems.push('has no <meta name="referrer" content="no-referrer">')

  for (const link of markup.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\srel="icon"/.test(link) || !/\shref="data:/.test(link)) problems.push(`has a <link> that isn't a data: icon: ${clip(link)}`)
  }
  for (const m of markup.matchAll(LOADING_ELEMENTS)) problems.push(`has a <${m[1]}> element: ${clip(m[0])}`)
  if (/http-equiv\s*=\s*["']?refresh/i.test(markup)) problems.push('has a <meta http-equiv="refresh">')

  const text = html.replace(BASE64_PAYLOAD, '$1')
  for (const api of NETWORK_APIS) {
    for (const m of text.matchAll(api.pattern)) {
      if (!insideInert(text, m.index, m[0].length)) problems.push(`uses ${api.name}: …${around(text, m.index)}…`)
    }
  }
  const inertUrls = new Set(INERT_URLS.map((u) => u.text))
  const inertSchemes = new Set(INERT_SCHEMES.map((s) => `${s.text}:`))
  for (const pattern of [ABSOLUTE_URL, RELATIVE_URL]) {
    for (const m of text.matchAll(pattern)) {
      const url = m[0].replace(/[.,;:!?]+$/, '')
      const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url)?.[0].toLowerCase()
      if (inertUrls.has(url) || (scheme && inertSchemes.has(scheme))) continue
      problems.push(`holds a URL not in INERT_URLS: ${url} (…${around(text, m.index)}…)`)
    }
  }
  return problems
}

/** The allowlist entries `html` no longer holds (so their reasons no longer apply): a dependency dropped the text. */
export function unusedInertTexts(html: string): string[] {
  const text = html.replace(BASE64_PAYLOAD, '$1')
  return [
    ...[...INERT_URLS, ...INERT_API_TEXTS].filter((t) => !text.includes(t.text)).map((t) => t.text),
    ...INERT_SCHEMES.filter((s) => !text.includes(`${s.text}://`)).map((s) => `${s.text}:`),
  ]
}

function checkCsp(markup: string, script: ScriptElement | undefined): string[] {
  const metas = [...markup.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/gi)]
  const [meta, ...extra] = metas
  if (!meta || extra.length > 0) return [`holds ${metas.length} CSP <meta> elements, not one`]

  const problems: string[] = []
  // The policy governs only what loads after it.
  const before = markup.slice(0, meta.index)
    .replace(/<!doctype[^>]*>|<\/?(?:html|head)\b[^>]*>|<meta charset="[^"]*"\s*\/?>/gi, '')
  if (before.trim() !== '') problems.push(`has markup before its CSP <meta>: ${clip(before.trim())}`)

  const directives = new Map<string, string[]>()
  for (const part of (meta[1] ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) directives.set(name.toLowerCase(), sources)
  }
  if (directives.get('default-src')?.join(' ') !== "'none'") problems.push("CSP: default-src isn't 'none'")
  for (const name of ['base-uri', 'form-action'] as const) {
    if (directives.get(name)?.join(' ') !== "'none'") problems.push(`CSP: ${name} isn't 'none'`)
  }
  for (const [name, sources] of directives) {
    for (const source of sources) {
      const allowed = source === "'none'" || source === 'data:' || source === 'blob:'
        || (name === 'style-src' && source === "'unsafe-inline'")
        || (name === 'script-src' && /^'sha256-[A-Za-z0-9+/]+=*'$/.test(source))
      if (!allowed) problems.push(`CSP: ${name} allows ${source}`)
    }
  }
  const scriptSources = directives.get('script-src') ?? []
  if (script && (scriptSources.length !== 1 || scriptSources[0] !== scriptHash(script.text))) {
    problems.push("CSP: script-src isn't the hash of the inline script alone")
  }
  return problems
}

function insideInert(text: string, at: number, length: number): boolean {
  return INERT_API_TEXTS.some(({ text: inert }) => {
    for (let i = text.indexOf(inert); i >= 0; i = text.indexOf(inert, i + 1)) {
      if (i <= at && at + length <= i + inert.length) return true
    }
    return false
  })
}

function around(text: string, at: number): string {
  return text.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, ' ')
}

function clip(s: string): string {
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}
