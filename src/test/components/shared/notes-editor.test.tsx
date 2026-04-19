import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { NotesEditor } from '../../../components/shared/notes/NotesEditor'

afterEach(cleanup)

/**
 * jsdom doesn't construct a real `ClipboardEvent`, so we dispatch a plain
 * `Event('paste')` and attach a `clipboardData` stub before the handler runs.
 * CodeMirror's paste handler reads the `types` array and `getData('text/html')`.
 */
function fakePasteEvent(html: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['text/html'],
      getData: (type: string) => (type === 'text/html' ? html : ''),
    },
  })
  return event
}

describe('NotesEditor — rich-text paste', () => {
  it('converts pasted HTML to Markdown in the editor', async () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const changes: string[] = []
    render(
      <NotesEditor
        value=""
        onChange={(v) => changes.push(v)}
        viewRef={viewRef}
      />,
    )
    const view = viewRef.current
    expect(view).not.toBeNull()

    const contentEl = view!.contentDOM
    const ev = fakePasteEvent('<h2>Title</h2><p><strong>bold</strong></p>')
    contentEl.dispatchEvent(ev)

    const doc = view!.state.doc.toString()
    expect(doc).toContain('## Title')
    expect(doc).toContain('**bold**')
    // Raw HTML must NOT have been inserted.
    expect(doc).not.toContain('<h2>')
    expect(doc).not.toContain('<strong>')
  })

  it('leaves plain-text paste untouched (CM default handles it)', async () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    render(
      <NotesEditor
        value=""
        onChange={() => {}}
        viewRef={viewRef}
      />,
    )
    const view = viewRef.current!
    const ev = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'clipboardData', {
      value: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? '**literal**' : ''),
      },
    })
    view.contentDOM.dispatchEvent(ev)
    // CM's default paste should have inserted the plain text verbatim — our
    // handler must NOT have converted it (there's no HTML to convert from).
    expect(view.state.doc.toString()).toBe('**literal**')
  })
})
