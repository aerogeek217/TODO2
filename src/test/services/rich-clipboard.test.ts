import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wrapClipboardHtml, writeRichClipboard } from '../../services/rich-clipboard'
import { copyNotesRich, mdToHtml } from '../../services/notes-export'

class StubClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

let write: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  write = vi.fn().mockResolvedValue(undefined)
  writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { write, writeText } })
  vi.stubGlobal('ClipboardItem', StubClipboardItem)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function written(): Promise<{ html: string; plain: string }> {
  const item = (write.mock.calls[0]![0] as StubClipboardItem[])[0]!
  return { html: await item.data['text/html']!.text(), plain: await item.data['text/plain']!.text() }
}

describe('writeRichClipboard', () => {
  it('writes the HTML and the plain text as one item', async () => {
    expect(await writeRichClipboard('<b>x</b>', 'x')).toBe(true)
    expect(await written()).toEqual({ html: '<b>x</b>', plain: 'x' })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to plain text without ClipboardItem, and reports a failure of both', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    expect(await writeRichClipboard('<b>x</b>', 'x')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('x')
    writeText.mockRejectedValueOnce(new Error('denied'))
    expect(await writeRichClipboard('<b>x</b>', 'x')).toBe(false)
  })
})

describe('copyNotesRich', () => {
  it('copies the note as wrapped HTML with its Markdown as the plain text', async () => {
    expect(await copyNotesRich('- one')).toBe(true)
    const { html, plain } = await written()
    expect(plain).toBe('- one')
    expect(html).toBe(wrapClipboardHtml(mdToHtml('- one')))
  })
})
