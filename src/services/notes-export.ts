/**
 * Notes export helpers (Markdown ↔ HTML, rich copy).
 * Users type Markdown with light shorthand (ALL-CAPS headings, em-dash
 * bullets). `normalizeToMarkdown` folds the shorthand into canonical
 * Markdown so `mdToHtml` (and external paste targets) see a clean stream.
 */

import { escapeHtml, unescapeHtml } from '../utils/html'
import { replaceMarkdownLinks } from '../utils/markdown-links'

const MAX_HEADING_LEN = 60
const MIN_HEADING_UPPERCASE_COUNT = 3
const ALL_CAPS_LINE = /^[A-Z][A-Z0-9 \-·]{2,60}$/
const LEADING_BULLET = /^[—–]\s*/
const LEADING_DOT = /^•\s*/

export function normalizeToMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      if (
        ALL_CAPS_LINE.test(trimmed)
        && trimmed.length <= MAX_HEADING_LEN
        && trimmed.replace(/[^A-Z]/g, '').length >= MIN_HEADING_UPPERCASE_COUNT
      ) {
        return `## ${trimmed}`
      }
      if (LEADING_BULLET.test(trimmed)) return trimmed.replace(LEADING_BULLET, '- ')
      if (LEADING_DOT.test(trimmed)) return trimmed.replace(LEADING_DOT, '- ')
      return line
    })
    .join('\n')
}

/**
 * Drops C0 control chars (U+0000–U+001F), DEL (U+007F), and whitespace.
 * A code-point loop rather than a `[\u0000-\u001f]` regex class, which
 * `no-control-regex` rejects.
 */
function stripControlAndWhitespace(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f || /\s/.test(ch)) continue
    out += ch
  }
  return out
}

const SAFE_URL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:']

/**
 * Returns a safe href for clipboard HTML. Uses an allowlist: only
 * `http(s)`, `mailto`, `tel`, and schemeless values (relative paths,
 * `#anchor`, `//host`) pass through. Everything else — `javascript:`,
 * `data:`, `vbscript:`, `file:`, `blob:`, etc. — is replaced with `'#'`.
 *
 * Normalises for known obfuscation tricks before the scheme compare:
 * strips ASCII whitespace + control chars, decodes a leading numeric
 * entity (`&#106;avascript:` → `javascript:`) so entity-encoded schemes
 * don't slip past the filter when the consumer later decodes them.
 */
export function sanitizeHref(raw: string): string {
  if (!raw) return '#'
  let s = raw
  // Decode any leading numeric entity (hex or decimal) so `&#106;avascript:`
  // etc. can't evade the allowlist. We don't need a full entity decoder —
  // just enough to un-hide the scheme byte(s).
  s = s.replace(/&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));/g, (_m, dec: string | undefined, hex: string | undefined) => {
    const n = dec != null ? parseInt(dec, 10) : parseInt(hex ?? '', 16)
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
  })
  // Strip ASCII whitespace + control chars (incl. \t, \n, \r, \0).
  s = stripControlAndWhitespace(s)
  const lower = s.toLowerCase()
  const colonIdx = lower.indexOf(':')
  const slashIdx = lower.indexOf('/')
  // Schemeless (relative path, anchor, //host) — no colon before first slash.
  // Return the stripped/decoded value (`s`) on allowed branches so we can't
  // smuggle whitespace or entity-obfuscated bytes past downstream consumers.
  if (colonIdx === -1) return s
  if (slashIdx !== -1 && slashIdx < colonIdx) return s
  const scheme = lower.slice(0, colonIdx + 1)
  return SAFE_URL_SCHEMES.includes(scheme) ? s : '#'
}

function inlineMd(s: string): string {
  // The line is escaped once, up front, so every capture below is already
  // HTML-safe text and goes into the output as is (escaping it again would
  // show `Dana&#39;s` in the pasted text). A link target is the exception:
  // it is unescaped back to the raw URL, checked by `sanitizeHref`, and
  // escaped for the attribute.
  const marked = escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, (_m, text: string) => `<strong>${text}</strong>`)
    .replace(/\*([^*]+)\*/g, (_m, text: string) => `<em>${text}</em>`)
    .replace(/`([^`]+)`/g, (_m, text: string) => `<code>${text}</code>`)
  return replaceMarkdownLinks(marked, (text, href) => {
    const safe = sanitizeHref(unescapeHtml(href))
    return `<a href="${escapeHtml(safe)}">${text}</a>`
  })
}

/**
 * Minimal Markdown → HTML for clipboard export. Supports headings (##),
 * bullets, task checkboxes, bold, italic, inline code, and links. Enough
 * fidelity for OneNote / Word / Outlook paste targets.
 */
export function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  const closeList = () => {
    if (inList) {
      out.push('</ul>')
      inList = false
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      closeList()
      continue
    }

    const h = line.match(/^(#{1,3})\s+(.+)$/)
    if (h && h[1] != null && h[2] != null) {
      closeList()
      out.push(`<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`)
      continue
    }

    const chk = line.match(/^-\s*\[( |x|X)\]\s+(.+)$/)
    if (chk && chk[1] != null && chk[2] != null) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      const checked = chk[1].toLowerCase() === 'x'
      out.push(`<li>${checked ? '☑ ' : '☐ '}${inlineMd(chk[2])}</li>`)
      continue
    }

    const bul = line.match(/^[-*]\s+(.+)$/)
    if (bul && bul[1] != null) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inlineMd(bul[1])}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inlineMd(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

/**
 * Best-effort HTML → Markdown converter for clipboard paste. Parses via
 * `DOMParser` into an inert document (scripts/styles never execute) and
 * walks the tree, emitting Markdown for the tags we support. Unknown tags
 * fall through to their text content.
 *
 * Intentionally narrow: supports the subset we also *produce* in
 * `mdToHtml`, so a round-trip `mdToHtml(htmlToMarkdown(x))` preserves the
 * structure of pasted content from OneNote / Google Docs / webpages.
 */
export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Drop script / style nodes outright — never evaluate, never emit.
  doc.querySelectorAll('script, style, noscript').forEach((n) => n.remove())
  const out = walkNode(doc.body).replace(/\n{3,}/g, '\n\n').trim()
  return out
}

/** Drops trailing `\n`s — a loop, as `/\n+$/` is quadratic on long runs of `\n`. */
function trimTrailingNewlines(s: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === '\n') end--
  return s.slice(0, end)
}

function walkNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse whitespace the way HTML rendering would, but keep single spaces.
    return (node.textContent ?? '').replace(/\s+/g, ' ')
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const inner = () => Array.from(el.childNodes).map(walkNode).join('')

  switch (tag) {
    case 'h1': return `\n# ${inner().trim()}\n\n`
    case 'h2': return `\n## ${inner().trim()}\n\n`
    case 'h3': return `\n### ${inner().trim()}\n\n`
    case 'h4':
    case 'h5':
    case 'h6': return `\n#### ${inner().trim()}\n\n`
    case 'br': return '\n'
    case 'p':
    case 'div':
    case 'section':
    case 'article': return `${inner()}\n\n`
    case 'strong':
    case 'b': {
      const text = inner().trim()
      return text ? `**${text}**` : ''
    }
    case 'em':
    case 'i': {
      const text = inner().trim()
      return text ? `*${text}*` : ''
    }
    case 'code': return `\`${inner()}\``
    case 'pre': {
      // <pre><code>…</code></pre> — emit fenced block.
      const codeChild = el.querySelector(':scope > code')
      const body = trimTrailingNewlines(codeChild?.textContent ?? el.textContent ?? '')
      return `\n\`\`\`\n${body}\n\`\`\`\n\n`
    }
    case 'a': {
      const rawHref = el.getAttribute('href') ?? ''
      const href = sanitizeHref(rawHref)
      const text = inner().trim() || href
      if (!rawHref) return text
      return `[${text}](${href})`
    }
    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol'
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li')
      const lines = items.map((li, idx) => {
        const checkbox = li.querySelector(':scope > input[type="checkbox"]')
        if (checkbox) {
          const checked = (checkbox as HTMLInputElement).checked || checkbox.hasAttribute('checked')
          // Remove the checkbox from the walked content so it doesn't double-emit.
          const clone = li.cloneNode(true) as HTMLElement
          clone.querySelector(':scope > input[type="checkbox"]')?.remove()
          const text = Array.from(clone.childNodes).map(walkNode).join('').trim()
          return `- [${checked ? 'x' : ' '}] ${text}`
        }
        const text = Array.from(li.childNodes).map(walkNode).join('').trim()
        return ordered ? `${idx + 1}. ${text}` : `- ${text}`
      })
      return `\n${lines.join('\n')}\n\n`
    }
    case 'li': {
      // Stray <li> outside a list — treat as bullet.
      return `- ${inner().trim()}\n`
    }
    case 'input': {
      const type = (el.getAttribute('type') ?? '').toLowerCase()
      if (type === 'checkbox') {
        const checked = (el as HTMLInputElement).checked || el.hasAttribute('checked')
        return `[${checked ? 'x' : ' '}] `
      }
      return ''
    }
    case 'blockquote': return `\n> ${inner().trim()}\n\n`
    case 'hr': return '\n---\n\n'
    default: return inner()
  }
}

/**
 * Copy the note content as rich text + plain text onto the clipboard.
 * Returns true on success. Falls back to plain-text-only if the
 * `ClipboardItem` API is unavailable or rejects (older browsers).
 */
export async function copyNotesRich(plain: string): Promise<boolean> {
  const md = normalizeToMarkdown(plain)
  const html = `<div style="font-family: Calibri, 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.45;">${mdToHtml(md)}</div>`
  try {
    const ClipItem = (globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
    if (!ClipItem) throw new Error('ClipboardItem unsupported')
    const item = new ClipItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([md], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return true
  } catch {
    try {
      await navigator.clipboard.writeText(md)
      return true
    } catch {
      return false
    }
  }
}
