import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { closeNotesPopup, notesNlp, notesPopupField, type NotesNlpConfig } from '../../../components/task/notes/notes-nlp'
import {
  armTabLeave, indentLines, indentListLines, isListLine, notesIndent, outdentLines, outdentListLines, tabLeavesField,
} from '../../../components/task/notes/notes-indent'
import { applyTextChanges } from '../../../services/note-lines'
import { personItems, statusItems, tagItems } from '../../../services/nlp-autocomplete'

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view?.dom.parentElement?.remove()
  view = null
})

const NLP: NotesNlpConfig = {
  sources: () => ({
    people: personItems([{ id: 1, name: 'Anna', initials: 'AN' }]),
    tags: tagItems([]),
    statuses: statusItems([]),
    commands: true,
    followupDefault: { count: 1, unit: 'm' },
    today: new Date(2026, 9, 10),
  }),
  resolverData: () => ({ people: [{ id: 1, name: 'Anna', initials: 'AN' }], statuses: [] }),
  onCreate: async () => {},
  subscribe: () => () => {},
}

function setup(doc: string, selection: { anchor: number; head?: number } = { anchor: doc.length }) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [notesNlp(NLP), notesIndent], selection }),
    parent,
  })
  return view
}

/** A keydown on the editor's content; whether a binding took it. */
function key(v: EditorView, k: string, shift = false): boolean {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })
  v.contentDOM.dispatchEvent(e)
  return e.defaultPrevented
}

describe('isListLine', () => {
  it.each(['- a', '* a', '• a', '  - a', '\t- a', '[ ] a', '- [x] a', '- [ ] a', '1. a', '12) a', '-', '- '])('%j is a list line', (line) => {
    expect(isListLine(line)).toBe(true)
  })
  it.each(['a', '# heading', '-a', '✓ done', '', '  text', '1.5 things'])('%j is not', (line) => {
    expect(isListLine(line)).toBe(false)
  })
})

describe('indentLines / outdentLines (pure)', () => {
  it('indents the caret line by two spaces', () => {
    const text = '- a\n- b'
    const changes = indentLines(text, 5, 5)
    expect(changes && applyTextChanges(text, changes)).toBe('- a\n  - b')
  })

  it('indents every line a selection touches, together', () => {
    const text = '- a\n- b\n- c'
    const changes = indentLines(text, 1, 6)
    expect(changes && applyTextChanges(text, changes)).toBe('  - a\n  - b\n- c')
  })

  it('refuses when any line under the selection is not a list line', () => {
    expect(indentLines('- a\ntext', 0, 7)).toBeNull()
    expect(indentLines('plain', 2, 2)).toBeNull()
  })

  it('outdents by up to two spaces, or one tab; a line at the margin contributes nothing', () => {
    const text = '    - a\n - b\n\t- c\n- d'
    const changes = outdentLines(text, 0, text.length)
    expect(changes && applyTextChanges(text, changes)).toBe('  - a\n- b\n- c\n- d')
  })

  it('outdent refuses off a list line', () => {
    expect(outdentLines('  text', 3, 3)).toBeNull()
  })
})

describe('the Tab / ⇧Tab commands in the editor', () => {
  it('Tab on a bullet indents it and keeps the caret on its text', () => {
    const v = setup('- a\n- b')
    expect(key(v, 'Tab')).toBe(true)
    expect(v.state.doc.toString()).toBe('- a\n  - b')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
  })

  it('⇧Tab outdents', () => {
    const v = setup('  - a')
    expect(key(v, 'Tab', true)).toBe(true)
    expect(v.state.doc.toString()).toBe('- a')
  })

  it('⇧Tab on a list line at the margin is consumed and changes nothing', () => {
    const v = setup('- a')
    expect(outdentListLines(v)).toBe(true)
    expect(v.state.doc.toString()).toBe('- a')
  })

  it('Tab off a list line is left to the host (not prevented, nothing inserted)', () => {
    const v = setup('plain text')
    expect(key(v, 'Tab')).toBe(false)
    expect(v.state.doc.toString()).toBe('plain text')
  })

  it('while the autocomplete popup is open the commands do nothing', () => {
    const v = setup('- Call ')
    const at = v.state.doc.length
    v.dispatch({ changes: { from: at, insert: '@' }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
    expect(v.state.field(notesPopupField)).not.toBeNull()
    expect(indentListLines(v)).toBe(false)
    expect(outdentListLines(v)).toBe(false)
    expect(v.state.doc.toString()).toBe('- Call @')
    v.dispatch({ effects: closeNotesPopup.of(null) })
    expect(indentListLines(v)).toBe(true)
  })

  it('Esc arms the next Tab to leave; typing or moving the caret disarms it', () => {
    const v = setup('- a')
    expect(key(v, 'Escape')).toBe(false) // the key goes on to the host
    expect(v.state.field(tabLeavesField)).toBe(true)
    expect(key(v, 'Tab')).toBe(false)
    expect(v.state.doc.toString()).toBe('- a')
    // Still armed (Tab changed nothing); a caret move disarms.
    v.dispatch({ selection: { anchor: 0 } })
    expect(v.state.field(tabLeavesField)).toBe(false)
    expect(key(v, 'Tab')).toBe(true)
    expect(v.state.doc.toString()).toBe('  - a')
    armTabLeave(v)
    expect(v.state.field(tabLeavesField)).toBe(true)
    v.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })
    expect(v.state.field(tabLeavesField)).toBe(false)
  })

  it('Esc while the popup is open is the popup’s: nothing armed', () => {
    const v = setup('- Call ')
    const at = v.state.doc.length
    v.dispatch({ changes: { from: at, insert: '@' }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
    expect(armTabLeave(v)).toBe(false)
    expect(v.state.field(tabLeavesField)).toBe(false)
  })
})
