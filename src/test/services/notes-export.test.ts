import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeToMarkdown, mdToHtml, copyNotesRich } from '../../services/notes-export'

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
