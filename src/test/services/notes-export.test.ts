import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeToMarkdown, mdToHtml, copyNotesRich, htmlToMarkdown } from '../../services/notes-export'

describe('normalizeToMarkdown', () => {
  it('converts ALL-CAPS lines into H2 headings', () => {
    const md = normalizeToMarkdown('MEETING NOTES\nbody text')
    expect(md).toBe('## MEETING NOTES\nbody text')
  })

  it('leaves mixed-case lines untouched', () => {
    const md = normalizeToMarkdown('Meeting notes\nbody')
    expect(md).toBe('Meeting notes\nbody')
  })

  it('skips ALL-CAPS lines that are too short (less than 3 uppercase letters)', () => {
    const md = normalizeToMarkdown('A B')
    expect(md).toBe('A B')
  })

  it('converts em-dash bullets to Markdown bullets', () => {
    const md = normalizeToMarkdown('— first\n– second\n• third')
    expect(md).toBe('- first\n- second\n- third')
  })

  it('preserves existing Markdown bullets and checkboxes', () => {
    const input = '- item\n- [ ] todo\n- [x] done'
    expect(normalizeToMarkdown(input)).toBe(input)
  })

  it('returns empty strings for blank lines', () => {
    const md = normalizeToMarkdown('hi\n\nthere')
    expect(md).toBe('hi\n\nthere')
  })
})

describe('mdToHtml', () => {
  it('renders headings, bullets, checkboxes, bold/italic, code, and links', () => {
    const input = [
      '## Meeting',
      '- item one',
      '- [ ] open task',
      '- [x] done task',
      '**bold** and *em* and `code` and [link](https://example.com)',
    ].join('\n')
    const html = mdToHtml(input)
    expect(html).toContain('<h2>Meeting</h2>')
    expect(html).toMatch(/<ul>\s*<li>item one<\/li>/)
    expect(html).toContain('<li>☐ open task</li>')
    expect(html).toContain('<li>☑ done task</li>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>em</em>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('closes the list on a blank line before switching to a paragraph', () => {
    const html = mdToHtml('- one\n- two\n\ntail')
    expect(html.match(/<\/ul>/g)?.length).toBe(1)
    expect(html).toContain('<p>tail</p>')
  })

  it('escapes HTML special chars inside plain text', () => {
    const html = mdToHtml('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('htmlToMarkdown', () => {
  it('converts headings h1–h3', () => {
    expect(htmlToMarkdown('<h1>A</h1><h2>B</h2><h3>C</h3>')).toBe('# A\n\n## B\n\n### C')
  })

  it('converts <ul><li> to dash bullets', () => {
    const md = htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')
    expect(md).toBe('- one\n- two')
  })

  it('converts <ol><li> to numbered list', () => {
    const md = htmlToMarkdown('<ol><li>one</li><li>two</li></ol>')
    expect(md).toBe('1. one\n2. two')
  })

  it('converts checkbox list items to [ ] / [x]', () => {
    const md = htmlToMarkdown(
      '<ul><li><input type="checkbox"> open</li><li><input type="checkbox" checked> done</li></ul>',
    )
    expect(md).toContain('- [ ] open')
    expect(md).toContain('- [x] done')
  })

  it('converts <strong>/<b> to ** and <em>/<i> to *', () => {
    expect(htmlToMarkdown('<p><strong>bold</strong> and <em>italic</em></p>')).toBe('**bold** and *italic*')
    expect(htmlToMarkdown('<p><b>bold</b> and <i>italic</i></p>')).toBe('**bold** and *italic*')
  })

  it('converts inline <code> to backticks', () => {
    expect(htmlToMarkdown('<p>see <code>fn()</code></p>')).toBe('see `fn()`')
  })

  it('converts <a href> to Markdown link', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com">X</a></p>')).toBe('[X](https://x.com)')
  })

  it('strips <script> tags', () => {
    const md = htmlToMarkdown('<p>before</p><script>alert(1)</script><p>after</p>')
    expect(md).not.toContain('alert')
    expect(md).not.toContain('script')
    expect(md).toContain('before')
    expect(md).toContain('after')
  })

  it('passes through unknown tags to their text content', () => {
    expect(htmlToMarkdown('<custom>text</custom>')).toBe('text')
  })

  it('round-trips mdToHtml(htmlToMarkdown(html)) for a known-good fixture', () => {
    const html = '<h2>Title</h2><ul><li>alpha</li><li>beta</li></ul><p><strong>bold</strong></p>'
    const md = htmlToMarkdown(html)
    const roundTripped = mdToHtml(md)
    expect(roundTripped).toContain('<h2>Title</h2>')
    expect(roundTripped).toContain('<li>alpha</li>')
    expect(roundTripped).toContain('<li>beta</li>')
    expect(roundTripped).toContain('<strong>bold</strong>')
  })
})

describe('copyNotesRich', () => {
  let writeSpy: ReturnType<typeof vi.fn>
  let writeTextSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeSpy = vi.fn().mockResolvedValue(undefined)
    writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { write: writeSpy, writeText: writeTextSpy },
    })
    class StubClipboardItem {
      constructor(public data: unknown) {}
    }
    ;(globalThis as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem = StubClipboardItem as unknown as typeof ClipboardItem
  })

  it('writes a ClipboardItem containing HTML + plain text', async () => {
    const ok = await copyNotesRich('HEADING\n- one')
    expect(ok).toBe(true)
    expect(writeSpy).toHaveBeenCalledTimes(1)
    expect(writeTextSpy).not.toHaveBeenCalled()
  })

  it('falls back to writeText when ClipboardItem rejects', async () => {
    writeSpy.mockRejectedValueOnce(new Error('denied'))
    const ok = await copyNotesRich('note')
    expect(ok).toBe(true)
    expect(writeTextSpy).toHaveBeenCalledTimes(1)
  })

  it('returns false when both paths reject', async () => {
    writeSpy.mockRejectedValueOnce(new Error('denied'))
    writeTextSpy.mockRejectedValueOnce(new Error('denied'))
    const ok = await copyNotesRich('note')
    expect(ok).toBe(false)
  })
})
