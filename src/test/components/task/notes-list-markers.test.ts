import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { deleteCharBackward, deleteCharForward } from '@codemirror/commands'
import { commonmarkLanguage } from '@codemirror/lang-markdown'
import { notesListMarkers } from '../../../components/task/notes/notes-list-markers'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view?.dom.parentElement?.remove()
  view = null
})

function setup(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({ state: EditorState.create({ doc, extensions: [commonmarkLanguage, notesListMarkers] }), parent })
  return view
}

/** Selects `anchor`–`head` as a drag would, then reads the selection that rests. */
function select(v: EditorView, anchor: number, head: number): { anchor: number; head: number } {
  v.dispatch({ selection: { anchor, head }, userEvent: 'select.pointer' })
  const { main } = v.state.selection
  return { anchor: main.anchor, head: main.head }
}

describe('a selection of whole list lines', () => {
  // A drag from a list line's left edge down to the next one's ends inside
  // that line's marker (it has no width): the end rests before it, so a
  // Delete leaves its bullet.
  it.each([
    ['in the marker', 7],
    ['after the marker', 8],
  ])('ends before the next line’s marker when it reaches %s', (_where, head) => {
    const v = setup('- one\n- two\n- three')
    expect(select(v, 0, head)).toEqual({ anchor: 0, head: 6 })
    deleteCharForward(v)
    expect(v.state.doc.toString()).toBe('- two\n- three')
  })

  it('Backspace leaves the next line’s bullet too', () => {
    const v = setup('- one\n- [ ] two\n- three')
    select(v, 0, 8)
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe('- [ ] two\n- three')
  })

  it('dragged upward, the end it reaches likewise', () => {
    const v = setup('- one\n- two\n- three')
    expect(select(v, 8, 0)).toEqual({ anchor: 6, head: 0 })
    deleteCharForward(v)
    expect(v.state.doc.toString()).toBe('- two\n- three')
  })

  it('from a plain line’s start, the list line it reaches keeps its bullet', () => {
    const v = setup('Intro\n- two')
    select(v, 0, 8)
    deleteCharForward(v)
    expect(v.state.doc.toString()).toBe('- two')
  })

  it('an indented line it reaches keeps its indent', () => {
    const v = setup('- one\n  - sub\n- three')
    expect(select(v, 0, 9)).toEqual({ anchor: 0, head: 6 })
    deleteCharForward(v)
    expect(v.state.doc.toString()).toBe('  - sub\n- three')
  })

  it('from after a line’s marker, the next line’s marker goes: the line keeps its own', () => {
    const v = setup('- one\n- two\n- three')
    expect(select(v, 2, 7)).toEqual({ anchor: 2, head: 8 })
    deleteCharForward(v)
    expect(v.state.doc.toString()).toBe('- two\n- three')
  })

  it('from inside a line’s text, the next line joins it without its marker', () => {
    const v = setup('- one\n- two')
    expect(select(v, 3, 7)).toEqual({ anchor: 3, head: 8 })
    deleteCharForward(v)
    expect(v.state.doc.toString()).toBe('- otwo')
  })
})
