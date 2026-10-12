/**
 * Handing a check-in email to the mail app, offline: a `mailto:` link (To +
 * Subject; the body goes on the clipboard to paste) or an unsent `.eml` draft
 * (`X-Unsent: 1`) with the HTML and plain-text bodies.
 */
import { toDateInputValue } from '../../utils/date'
import { writeRichClipboard } from '../task-copy'

/**
 * `s` without control characters (CR, LF, tab and the rest of C0, DEL):
 * a header value or `mailto:` part can't be split into extra lines.
 */
function stripControls(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    out += code <= 0x1f || code === 0x7f ? ' ' : ch
  }
  return out.replace(/ {2,}/g, ' ').trim()
}

/** An address as it may go in a header or `mailto:`: no controls, spaces or angle brackets. */
function cleanAddress(address: string): string {
  return stripControls(address).replace(/[\s<>]/g, '')
}

/**
 * `mailto:<to>?subject=<subject>` — no body (the body is pasted from the
 * clipboard). Both parts are percent-encoded, so neither can add recipients
 * or other fields; `@` stays readable.
 */
export function buildMailtoUrl(to: string, subject: string): string {
  const addr = encodeURIComponent(cleanAddress(to)).replace(/%40/g, '@')
  return `mailto:${addr}?subject=${encodeURIComponent(stripControls(subject))}`
}

// ── .eml ────────────────────────────────────────────────────────────────

/** Separates the `.eml` parts; base64 lines never contain `_` or `-`, so it can't occur in a part. */
export const EML_BOUNDARY = '=_todo2_checkin_part_='

const CRLF = '\r\n'

function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** Base64 in lines of at most 76 characters (RFC 2045). */
function base64Lines(s: string): string {
  const b64 = utf8Base64(s)
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76))
  return lines.join(CRLF)
}

/** Text with every line break as CRLF. */
function toCrlf(s: string): string {
  return s.replace(/\r\n?|\n/g, CRLF)
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/
/** Longest UTF-8 chunk per encoded word: 45 bytes → 60 base64 chars, within RFC 2047's 75. */
const ENCODED_WORD_BYTES = 45

/**
 * RFC 2047 encoded words (`=?UTF-8?B?…?=`) for `s`, split on character
 * boundaries so each word stays within 75 characters, joined by folding
 * whitespace (CRLF + space).
 */
export function encodeHeaderWords(s: string): string {
  const encoder = new TextEncoder()
  const words: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const ch of s) {
    const n = encoder.encode(ch).length
    if (chunkBytes + n > ENCODED_WORD_BYTES && chunk !== '') {
      words.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += ch
    chunkBytes += n
  }
  if (chunk !== '') words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${utf8Base64(w)}?=`).join(`${CRLF} `)
}

/** An unstructured header value: as is when short printable ASCII, else encoded words. */
function headerText(s: string): string {
  const clean = stripControls(s)
  return PRINTABLE_ASCII.test(clean) && clean.length <= 900 ? clean : encodeHeaderWords(clean)
}

/** `"Name" <address>` (quoted string, or encoded words when not ASCII); just the address without a name. */
function headerMailbox(address: string, name: string | undefined): string {
  const addr = cleanAddress(address)
  const display = stripControls(name ?? '')
  if (display === '') return addr
  const phrase = PRINTABLE_ASCII.test(display) && display.length <= 200
    ? `"${display.replace(/["\\]/g, (c) => `\\${c}`)}"`
    : encodeHeaderWords(display)
  return `${phrase} <${addr}>`
}

export interface EmlInput {
  /** Recipient address. */
  to: string
  /** Recipient display name (optional). */
  toName?: string
  subject: string
  /** The HTML body fragment (wrapped in a full document here). */
  html: string
  plain: string
}

/**
 * An unsent draft as an `.eml` file (RFC 5322 + MIME): `X-Unsent: 1`,
 * `multipart/alternative` with a UTF-8 plain-text part then an HTML part,
 * both base64. Every header value has its control characters (CR / LF
 * included) removed, so no value can start a new header. CRLF line endings.
 */
export function buildEml(input: EmlInput): string {
  const htmlDoc = [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"></head>',
    `<body>${input.html}</body></html>`,
  ].join('\n')
  const lines = [
    'X-Unsent: 1',
    `To: ${headerMailbox(input.to, input.toName)}`,
    `Subject: ${headerText(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${EML_BOUNDARY}"`,
    '',
    `--${EML_BOUNDARY}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(toCrlf(input.plain)),
    `--${EML_BOUNDARY}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(toCrlf(htmlDoc)),
    `--${EML_BOUNDARY}--`,
    '',
  ]
  return lines.join(CRLF)
}

/**
 * Puts the email body on the clipboard as rich HTML + plain text (falls back
 * to plain text). Call it from the click handler, before opening the
 * `mailto:` link: the clipboard needs the user gesture. True on success.
 */
export function copyCheckinRich(html: string, plain: string): Promise<boolean> {
  return writeRichClipboard(html, plain)
}

/**
 * Opens a `mailto:` link through a temporary `<a target="_blank">` click.
 * A new browsing context, not this page: navigating the page itself to a
 * `mailto:` URL runs its `beforeunload` handlers, so unsaved workspace
 * changes would prompt "Leave site?". The browser hands the link to the mail
 * app and closes the empty tab. (A hidden iframe would be blocked by the
 * app's Content Security Policy.)
 */
export function openMailtoLink(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
  }
}

/** Characters Windows / macOS don't allow in a file name (control characters are dropped separately). */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/g

/** `Check-in - <name> - <YYYY-MM-DD>.eml`; characters a file name can't hold become spaces. */
export function checkinEmlFileName(personName: string, sentAt: Date): string {
  const name = stripControls(personName).replace(UNSAFE_FILE_CHARS, ' ').replace(/\s+/g, ' ').trim() || 'person'
  return `Check-in - ${name} - ${toDateInputValue(sentAt)}.eml`
}
