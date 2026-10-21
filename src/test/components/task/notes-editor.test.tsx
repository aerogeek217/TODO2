import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { NotesEditor } from '../../../components/task/notes/NotesEditor'
import type { NotesNlpConfig } from '../../../components/task/notes/notes-nlp'
import { personItems, statusItems, tagItems } from '../../../services/nlp-autocomplete'

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

describe('NotesEditor — click-to-focus below content', () => {
  it('moves caret to doc end + focuses when mousedown lands outside .cm-content', () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const { container } = render(
      <NotesEditor
        value={'hello\nworld'}
        onChange={() => {}}
        viewRef={viewRef}
      />,
    )
    const view = viewRef.current!
    // Start with the caret at position 0 so the end-of-doc move is observable.
    view.dispatch({ selection: { anchor: 0 } })
    expect(view.state.selection.main.head).toBe(0)

    // The dead zone lives on .cm-scroller (its bottom padding) — simulate a
    // click there. `.cm-scroller` is never a child of `.cm-content`, so the
    // handler should run.
    const scroller = container.querySelector('.cm-scroller') as HTMLElement
    expect(scroller).toBeTruthy()
    fireEvent.mouseDown(scroller)

    expect(view.state.selection.main.head).toBe(view.state.doc.length)
    expect(view.hasFocus).toBe(true)
  })

  it('does not hijack mousedown inside .cm-content', () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const { container } = render(
      <NotesEditor
        value={'hello\nworld'}
        onChange={() => {}}
        viewRef={viewRef}
      />,
    )
    const view = viewRef.current!
    view.dispatch({ selection: { anchor: 2 } })

    const content = container.querySelector('.cm-content') as HTMLElement
    expect(content).toBeTruthy()
    fireEvent.mouseDown(content)

    // Our handler must early-return — if it had run, the caret would have
    // snapped to doc end. CM6's own mousedown logic may move the caret
    // elsewhere based on click coords, so assert the specific "handler ran"
    // signature (caret === doc.length) is absent.
    expect(view.state.selection.main.head).not.toBe(view.state.doc.length)
  })
})

describe('NotesEditor — the `@ # /` popup', () => {
  // JSDOM has no layout for Ranges; the open popup measures the caret with them.
  const range = Range.prototype as { getClientRects?: unknown; getBoundingClientRect?: unknown }
  beforeEach(() => {
    range.getClientRects = () => [] as unknown as DOMRectList
    range.getBoundingClientRect = () => new DOMRect()
  })
  afterEach(() => {
    delete range.getClientRects
    delete range.getBoundingClientRect
  })

  function nlpConfig(onCreate: NotesNlpConfig['onCreate']): NotesNlpConfig {
    return {
      sources: () => ({
        people: personItems([]),
        tags: tagItems([]),
        statuses: statusItems([]),
        commands: true,
        followupDefault: { count: 1, unit: 'm' },
        today: new Date(2026, 9, 10),
      }),
      resolverData: () => ({ people: [], statuses: [] }),
      onCreate,
    }
  }

  /** Types `text` at the caret, then picks the popup's row with Enter. */
  function typeAndPick(view: EditorView, text: string) {
    for (const ch of text) {
      const at = view.state.selection.main.head
      view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
    }
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  }

  it('a create row that fails reports its message through onNlpError', async () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const onCreate = vi.fn(() => Promise.reject(new Error('You can have at most 50 tags.')))
    const onNlpError = vi.fn()
    render(<NotesEditor value="- Plan " onChange={() => {}} viewRef={viewRef} nlp={nlpConfig(onCreate)} onNlpError={onNlpError} />)
    const view = viewRef.current!
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    typeAndPick(view, '#launch')
    expect(onCreate).toHaveBeenCalledWith('#', 'launch')
    await vi.waitFor(() => expect(onNlpError).toHaveBeenCalledWith('You can have at most 50 tags.'))
  })

  it('reports to the latest onNlpError (the editor is built once)', async () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const onCreate = vi.fn(() => Promise.reject(new Error('nope')))
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(<NotesEditor value="" onChange={() => {}} viewRef={viewRef} nlp={nlpConfig(onCreate)} onNlpError={first} />)
    rerender(<NotesEditor value="" onChange={() => {}} viewRef={viewRef} nlp={nlpConfig(onCreate)} onNlpError={latest} />)
    typeAndPick(viewRef.current!, '@Marco')
    await vi.waitFor(() => expect(latest).toHaveBeenCalledWith('nope'))
    expect(first).not.toHaveBeenCalled()
  })
})

describe('NotesEditor — value and callbacks', () => {
  it('a new value from the parent replaces the text without being reported back', () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const onChange = vi.fn()
    const { rerender } = render(<NotesEditor value="one" onChange={onChange} viewRef={viewRef} />)
    rerender(<NotesEditor value="two" onChange={onChange} viewRef={viewRef} />)
    expect(viewRef.current!.state.doc.toString()).toBe('two')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports an edit to the latest onChange', () => {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender } = render(<NotesEditor value="" onChange={first} viewRef={viewRef} />)
    rerender(<NotesEditor value="" onChange={latest} viewRef={viewRef} />)
    viewRef.current!.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(latest).toHaveBeenCalledWith('x')
    expect(first).not.toHaveBeenCalled()
  })
})

describe('NotesEditor — Markdown editing', () => {
  function editorWith(doc: string) {
    const viewRef = createRef<EditorView>() as { current: EditorView | null }
    render(<NotesEditor value={doc} onChange={() => {}} viewRef={viewRef} />)
    const view = viewRef.current!
    view.dispatch({ selection: { anchor: doc.length } })
    return view
  }
  const press = (view: EditorView, key: string) =>
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  it('Enter at the end of a list item starts the next item', () => {
    const view = editorWith('- one')
    press(view, 'Enter')
    expect(view.state.doc.toString()).toBe('- one\n- ')
  })

  it('Backspace after an empty item’s marker turns it into the item’s indent', () => {
    const view = editorWith('- one\n- ')
    press(view, 'Backspace')
    expect(view.state.doc.toString()).toBe('- one\n  ')
  })

  it('a URL pasted over selected text makes it a link', () => {
    const view = editorWith('docs')
    view.dispatch({ selection: { anchor: 0, head: 4 } })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? 'https://example.com' : '') },
    })
    view.contentDOM.dispatchEvent(event)
    expect(view.state.doc.toString()).toBe('[docs](https://example.com)')
  })
})
