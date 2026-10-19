import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EML_BOUNDARY,
  InvalidRecipientError,
  buildEml,
  buildMailtoUrl,
  copyCheckinRich,
  encodeHeaderWords,
  type EmlInput,
} from '../../../services/checkin-email/handoff'

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Decodes a header value made of RFC 2047 B-encoded UTF-8 words (folding removed). */
function decodeHeaderWords(value: string): string {
  return value
    .replace(/\r\n /g, '')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_m, b64: string) => decodeBase64Utf8(b64))
}

interface ParsedEml {
  headerLines: string[]
  headers: Map<string, string>
  parts: { headers: string[]; body: string }[]
}

function parseEml(eml: string): ParsedEml {
  const split = eml.indexOf('\r\n\r\n')
  const headerBlock = eml.slice(0, split)
  const headerLines = headerBlock.split('\r\n')
  const headers = new Map<string, string>()
  let last = ''
  for (const line of headerLines) {
    if (line.startsWith(' ')) {
      headers.set(last, `${headers.get(last)}\r\n${line}`)
      continue
    }
    const colon = line.indexOf(':')
    last = line.slice(0, colon)
    headers.set(last, line.slice(colon + 1).trim())
  }
  const body = eml.slice(split + 4)
  const chunks = body.split(`--${EML_BOUNDARY}`)
  const parts = chunks.slice(1, -1).map((chunk) => {
    const trimmed = chunk.replace(/^\r\n/, '')
    const sep = trimmed.indexOf('\r\n\r\n')
    return { headers: trimmed.slice(0, sep).split('\r\n'), body: trimmed.slice(sep + 4).replace(/\r\n$/, '') }
  })
  return { headerLines, headers, parts }
}

const input: EmlInput = {
  to: 'marcus.chen@example.com',
  toName: 'Marcus Chen',
  subject: 'Task check-in: 3 open tasks',
  html: '<div><p>Hi Marcus,</p><p>Ref 0c4d8e17 — café</p></div>',
  plain: 'Hi Marcus,\n\n1. Task  Ref 0c4d8e17\nCompleted: [ ]\nThanks,',
}

describe('buildMailtoUrl', () => {
  it('fills To and Subject only, percent-encoded', () => {
    expect(buildMailtoUrl('marcus.chen@example.com', 'Task check-in: 3 open tasks'))
      .toBe('mailto:marcus.chen@example.com?subject=Task%20check-in%3A%203%20open%20tasks')
  })

  it('cannot add fields or recipients through the subject', () => {
    const url = buildMailtoUrl('a@b.com', 'Hi&bcc=evil@x.com\r\nBcc: z@z.com')
    expect(url.startsWith('mailto:a@b.com?subject=')).toBe(true)
    const query = url.slice(url.indexOf('?') + 1)
    expect(query.split('&')).toHaveLength(1)
    expect(query).not.toMatch(/%0[ad]/i)
    expect(decodeURIComponent(query.slice('subject='.length))).toBe('Hi&bcc=evil@x.com Bcc: z@z.com')
    expect(url).not.toContain('body=')
  })

  it('trims the address; encodes non-ASCII subjects and address characters', () => {
    expect(buildMailtoUrl('  a@b.com \n', 'Café')).toBe('mailto:a@b.com?subject=Caf%C3%A9')
    expect(buildMailtoUrl("o'neil+work@b.com", 'x')).toBe("mailto:o'neil%2Bwork@b.com?subject=x")
  })

  it.each([
    ['a comma (a second recipient)', 'a@b.com,evil@x.com'],
    ['a semicolon', 'a@b.com;evil@x.com'],
    ['a query', 'a@b.com?cc=evil@x.com&body=hi'],
    ['angle brackets', '<a@b.com>'],
    ['a display name', '"Ann" a@b.com'],
    ['a line break', 'a@b.com\r\nBcc: z@z.com'],
    ['a bare name', 'Ann'],
    ['a name with a line break', 'Ann\r\nBcc: z@z.com'],
  ])('refuses an address with %s', (_name, to) => {
    expect(() => buildMailtoUrl(to, 'Hi')).toThrow(InvalidRecipientError)
    expect(() => buildEml({ ...input, to })).toThrow(InvalidRecipientError)
  })

  it('no address: an empty To (the recipient is added in the mail app)', () => {
    expect(buildMailtoUrl('', 'Task check-in: 3 open tasks')).toBe('mailto:?subject=Task%20check-in%3A%203%20open%20tasks')
    expect(buildMailtoUrl(' \t ', 'Hi')).toBe('mailto:?subject=Hi')
  })

  it('no address: the subject still cannot add fields or recipients', () => {
    const url = buildMailtoUrl('', 'Hi&to=evil@x.com&bcc=z@z.com\r\nTo: y@y.com')
    expect(url.startsWith('mailto:?subject=')).toBe(true)
    const query = url.slice(url.indexOf('?') + 1)
    expect(query.split('&')).toHaveLength(1)
    expect(query).not.toMatch(/%0[ad]/i)
  })
})

describe('buildEml', () => {
  it('is an unsent multipart/alternative draft with CRLF line endings', () => {
    const eml = buildEml(input)
    expect(eml).not.toMatch(/[^\r]\n/)
    expect(eml).not.toMatch(/\r(?!\n)/)
    const { headers, parts } = parseEml(eml)
    expect(headers.get('X-Unsent')).toBe('1')
    expect(headers.get('MIME-Version')).toBe('1.0')
    expect(headers.get('Content-Type')).toBe(`multipart/alternative; boundary="${EML_BOUNDARY}"`)
    expect(headers.get('To')).toBe('"Marcus Chen" <marcus.chen@example.com>')
    expect(headers.get('Subject')).toBe('Task check-in: 3 open tasks')
    expect(eml.trimEnd().endsWith(`--${EML_BOUNDARY}--`)).toBe(true)
    expect(parts).toHaveLength(2)
    expect(parts[0]?.headers).toEqual(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'])
    expect(parts[1]?.headers).toEqual(['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64'])
  })

  it('carries both bodies as UTF-8 base64 in lines of at most 76 characters', () => {
    const plain = `${input.plain}\n${'Long line with ünïcödé. '.repeat(20)}`
    const { parts } = parseEml(buildEml({ ...input, plain }))
    for (const part of parts) {
      for (const line of part.body.split('\r\n')) {
        expect(line.length).toBeLessThanOrEqual(76)
        expect(line).toMatch(/^[A-Za-z0-9+/=]*$/)
      }
    }
    expect(decodeBase64Utf8(parts[0]!.body)).toBe(plain.replace(/\n/g, '\r\n'))
    const html = decodeBase64Utf8(parts[1]!.body)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain(input.html)
  })

  it('encodes a non-ASCII subject and display name as RFC 2047 words of at most 75 characters', () => {
    const subject = `Tâche: ${'é'.repeat(80)} ✓`
    const eml = buildEml({ ...input, subject, toName: 'Zoë “Z” Ünal' })
    const { headers, headerLines } = parseEml(eml)
    const subj = headers.get('Subject') ?? ''
    expect(decodeHeaderWords(subj)).toBe(subject)
    for (const word of subj.match(/=\?[^?]+\?B\?[^?]*\?=/g) ?? []) expect(word.length).toBeLessThanOrEqual(75)
    expect(subj).toContain('\r\n ')
    expect(decodeHeaderWords(headers.get('To') ?? '')).toBe('Zoë “Z” Ünal <marcus.chen@example.com>')
    for (const line of headerLines) expect(line.length).toBeLessThanOrEqual(998)
  })

  it('splits encoded words on character boundaries', () => {
    const s = '😀'.repeat(30)
    const words = encodeHeaderWords(s).split('\r\n ')
    expect(words.length).toBeGreaterThan(1)
    for (const w of words) expect(decodeHeaderWords(w)).toMatch(/^(😀)+$/)
    expect(decodeHeaderWords(encodeHeaderWords(s))).toBe(s)
  })

  it('quotes a display name with quotes / backslashes; no name → bare address', () => {
    expect(parseEml(buildEml({ ...input, toName: 'A "B" \\C' })).headers.get('To')).toBe('"A \\"B\\" \\\\C" <marcus.chen@example.com>')
    expect(parseEml(buildEml({ ...input, toName: undefined })).headers.get('To')).toBe('marcus.chen@example.com')
    expect(parseEml(buildEml({ ...input, toName: '  ' })).headers.get('To')).toBe('marcus.chen@example.com')
  })

  it('header injection: CR / LF in any header value never starts a new header', () => {
    const eml = buildEml({
      ...input,
      to: 'victim@example.com',
      toName: 'Name\r\nBcc: evil2@x.com\nX-Evil: 1',
      subject: 'Hi\r\nBcc: evil3@x.com\rX-Evil: 2\n\nbody',
    })
    const { headerLines, headers } = parseEml(eml)
    const names = headerLines.filter((l) => !l.startsWith(' ')).map((l) => l.slice(0, l.indexOf(':')))
    expect(names).toEqual(['X-Unsent', 'To', 'Subject', 'MIME-Version', 'Content-Type'])
    expect(eml).not.toMatch(/^(Bcc|X-Evil):/im)
    expect(headers.get('To')).toBe('"Name Bcc: evil2@x.com X-Evil: 1" <victim@example.com>')
    expect(headers.get('Subject')).toBe('Hi Bcc: evil3@x.com X-Evil: 2 body')
  })

  it('a body containing the boundary text cannot end a part early', () => {
    const plain = `--${EML_BOUNDARY}--\nfake`
    const { parts } = parseEml(buildEml({ ...input, plain }))
    expect(parts).toHaveLength(2)
    expect(decodeBase64Utf8(parts[0]!.body)).toBe(`--${EML_BOUNDARY}--\r\nfake`)
  })
})

describe('buildEml without an address', () => {
  it('has no To header at all — the name is never put in a To field — and stays an unsent draft', () => {
    for (const to of ['', '  ', '\r\n']) {
      const eml = buildEml({ ...input, to })
      const { headerLines, headers, parts } = parseEml(eml)
      const names = headerLines.filter((l) => !l.startsWith(' ')).map((l) => l.slice(0, l.indexOf(':')))
      expect(names).toEqual(['X-Unsent', 'Subject', 'MIME-Version', 'Content-Type'])
      expect(headers.get('X-Unsent')).toBe('1')
      expect(eml).not.toMatch(/^To:/im)
      expect(eml.slice(0, eml.indexOf('\r\n\r\n'))).not.toContain('Marcus Chen')
      expect(parts).toHaveLength(2)
    }
  })

  it('header injection: an odd name or subject cannot add a To / Bcc header', () => {
    const eml = buildEml({
      ...input,
      to: '',
      toName: 'Ann <evil@x.com>\r\nTo: evil2@x.com\nBcc: evil3@x.com',
      subject: 'Hi\r\nTo: evil4@x.com\rBcc: evil5@x.com\n\nbody',
    })
    const { headerLines, headers } = parseEml(eml)
    const names = headerLines.filter((l) => !l.startsWith(' ')).map((l) => l.slice(0, l.indexOf(':')))
    expect(names).toEqual(['X-Unsent', 'Subject', 'MIME-Version', 'Content-Type'])
    expect(eml).not.toMatch(/^(To|Bcc|Cc):/im)
    expect(eml).not.toContain('evil@x.com')
    expect(headers.get('Subject')).toBe('Hi To: evil4@x.com Bcc: evil5@x.com body')
  })
})

describe('copyCheckinRich', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('writes text/html and text/plain to the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText: vi.fn() } })
    vi.stubGlobal('ClipboardItem', class {
      constructor(public data: Record<string, Blob>) {}
    })
    expect(await copyCheckinRich('<p>Hi</p>', 'Hi')).toBe(true)
    const [[items]] = write.mock.calls as [[{ data: Record<string, Blob> }[]]]
    expect(await items[0]?.data['text/html']?.text()).toBe('<p>Hi</p>')
    expect(await items[0]?.data['text/plain']?.text()).toBe('Hi')
  })
})
