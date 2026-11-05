import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { NotesToolbar } from '../../../components/task/notes/NotesToolbar'

function makeView(doc: string): EditorView {
  const state = EditorState.create({ doc })
  return new EditorView({ state, parent: document.body })
}

function selectRange(view: EditorView, anchor: number, head: number) {
  view.dispatch({ selection: { anchor, head } })
}

describe('NotesToolbar', () => {
  let view: EditorView
  let viewRef: { current: EditorView | null }
  let onCopy: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    view = makeView('hello world')
    viewRef = { current: view }
    onCopy = vi.fn<() => void>()
  })

  afterEach(() => {
    view.destroy()
    cleanup()
  })

  it('has no bold, italic or heading buttons', () => {
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    for (const name of ['Bold', 'Italic', 'Heading 1', 'Heading 2']) {
      expect(screen.queryByLabelText(name)).toBeNull()
    }
  })

  it('Bullet prepends `- ` to the current line', () => {
    selectRange(view, 0, 0)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Bullet list'))
    expect(view.state.doc.toString()).toBe('- hello world')
  })

  it('Checkbox prepends `- [ ] ` to the current line', () => {
    selectRange(view, 0, 0)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Checkbox'))
    expect(view.state.doc.toString()).toBe('- [ ] hello world')
  })

  it('Bullet across multiple selected lines prefixes each line', () => {
    view.destroy()
    view = makeView('one\ntwo\nthree')
    viewRef.current = view
    selectRange(view, 0, view.state.doc.length)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Bullet list'))
    expect(view.state.doc.toString()).toBe('- one\n- two\n- three')
  })

  describe('the list buttons change or toggle what a line has', () => {
    const click = (name: string, doc: string, from = 0, to = from) => {
      view.destroy()
      view = makeView(doc)
      viewRef.current = view
      selectRange(view, from, to)
      const { unmount } = render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
      fireEvent.click(screen.getByLabelText(name))
      unmount()
      return view.state.doc.toString()
    }

    it.each([
      ['Bullet list', '- item', 'item'],
      ['Bullet list', '* item', 'item'],
      ['Bullet list', '• item', 'item'],
      ['Bullet list', '- [ ] item', '- item'],
      ['Bullet list', '[ ] item', '- item'],
      ['Bullet list', '- [x] item', '- item'],
      ['Bullet list', '- ', ''],
      ['Bullet list', '- [ ] ', '- '],
      ['Bullet list', '', '- '],
      ['Checkbox', '- [ ] item', 'item'],
      ['Checkbox', '[ ] item', 'item'],
      ['Checkbox', '- [x] item', 'item'],
      ['Checkbox', '- item', '- [ ] item'],
      ['Checkbox', '* item', '- [ ] item'],
      ['Checkbox', '- ', '- [ ] '],
      ['Checkbox', '', '- [ ] '],
      ['Checkbox', '  - nested', '  - [ ] nested'],
      ['Bullet list', '  - [ ] nested', '  - nested'],
      ['Bullet list', '  - nested', '  nested'],
      ['Bullet list', '  plain', '  - plain'],
    ])('%s on %j gives %j', (name, doc, result) => {
      expect(click(name, doc, doc.length)).toBe(result)
    })

    it('the caret stays in the text', () => {
      click('Checkbox', '- item', 4)
      expect(view.state.doc.toString()).toBe('- [ ] item')
      expect(view.state.selection.main.head).toBe(8)
      click('Bullet list', '- item', 4)
      expect(view.state.doc.toString()).toBe('item')
      expect(view.state.selection.main.head).toBe(2)
    })

    it('a caret on an empty line or at the start of the text goes after the new marker', () => {
      click('Checkbox', '')
      expect(view.state.selection.main.head).toBe(6)
      click('Bullet list', 'item')
      expect(view.state.selection.main.head).toBe(2)
    })

    it('over several lines: all of that kind go back to plain, else all become it; blank lines are left alone', () => {
      const all = '- one\n\n- two'
      expect(click('Bullet list', all, 0, all.length)).toBe('one\n\ntwo')
      const mixed = '- one\nplain\n- [ ] box'
      expect(click('Bullet list', mixed, 0, mixed.length)).toBe('- one\n- plain\n- box')
      expect(click('Checkbox', mixed, 0, mixed.length)).toBe('- [ ] one\n- [ ] plain\n- [ ] box')
    })
  })

  it('Outdent sits before Indent, as in other editors', () => {
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    const order = screen.getByLabelText('Outdent').compareDocumentPosition(screen.getByLabelText('Indent'))
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Indent / Outdent move the list lines under the selection one level; a plain line is left alone', () => {
    view.destroy()
    view = makeView('- a\n- b\nplain')
    viewRef = { current: view }
    selectRange(view, 0, 5)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Indent'))
    expect(view.state.doc.toString()).toBe('  - a\n  - b\nplain')
    fireEvent.click(screen.getByLabelText('Outdent'))
    expect(view.state.doc.toString()).toBe('- a\n- b\nplain')
    selectRange(view, 10, 10)
    fireEvent.click(screen.getByLabelText('Indent'))
    expect(view.state.doc.toString()).toBe('- a\n- b\nplain')
  })

  it('Copy rich invokes the onCopy callback', () => {
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Copy as rich text'))
    expect(onCopy).toHaveBeenCalledOnce()
  })
})
