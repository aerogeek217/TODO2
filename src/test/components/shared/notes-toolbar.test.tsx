import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { NotesToolbar } from '../../../components/shared/notes/NotesToolbar'

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

  it('Bold wraps the current selection in **', () => {
    selectRange(view, 0, 5) // "hello"
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Bold'))
    expect(view.state.doc.toString()).toBe('**hello** world')
  })

  it('Italic wraps the current selection in *', () => {
    selectRange(view, 6, 11) // "world"
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Italic'))
    expect(view.state.doc.toString()).toBe('hello *world*')
  })

  it('Bold with collapsed caret inserts `****` and places cursor between markers', () => {
    selectRange(view, 5, 5)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Bold'))
    expect(view.state.doc.toString()).toBe('hello**** world')
    expect(view.state.selection.main.anchor).toBe(7)
  })

  it('Heading 1 prepends `# ` to the current line', () => {
    selectRange(view, 0, 0)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Heading 1'))
    expect(view.state.doc.toString()).toBe('# hello world')
  })

  it('Heading 2 replaces an existing H1 marker', () => {
    view.destroy()
    view = makeView('# title')
    viewRef.current = view
    selectRange(view, 0, 0)
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Heading 2'))
    expect(view.state.doc.toString()).toBe('## title')
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

  it('Copy rich invokes the onCopy callback', () => {
    render(<NotesToolbar viewRef={viewRef} onCopy={onCopy} />)
    fireEvent.click(screen.getByLabelText('Copy as rich text'))
    expect(onCopy).toHaveBeenCalledOnce()
  })
})
