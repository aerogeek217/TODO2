import { describe, it, expect, afterEach, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Person, Status } from '../../../models'
import { closeNotesPopup, highlightNotesPopupRow, holdNotesPopup, notesNlp, notesPopupField, notesPopupFocusEffect, type NotesNlpConfig } from '../../../components/task/notes/notes-nlp'
import { personItems, statusItems, tagItems } from '../../../services/nlp-autocomplete'

// Sat 10 Oct 2026.
const TODAY = new Date(2026, 9, 10)

const PEOPLE: Person[] = [
  { id: 1, name: 'Anna', initials: 'AN' },
  { id: 2, name: 'Dana Kim', initials: 'DK' },
]
const STATUSES: Status[] = [
  { id: 1, name: 'To do', color: '#888', sortOrder: 0 },
  { id: 2, name: 'In progress', color: '#08f', sortOrder: 1 },
]

let view: EditorView | null = null

afterEach(() => {
  view?.destroy()
  view?.dom.parentElement?.remove()
  view = null
})

function setup(doc = '', people: Person[] = PEOPLE) {
  const listeners = new Set<() => void>()
  const state = { people }
  const onCreate = vi.fn(async () => {})
  const config: NotesNlpConfig = {
    sources: () => ({
      people: personItems(state.people),
      tags: tagItems([{ id: 1, name: 'q4', color: '#000' }]),
      statuses: statusItems(STATUSES),
      commands: true,
      followupDefault: { count: 1, unit: 'm' },
      today: TODAY,
    }),
    resolverData: () => ({ people: state.people, statuses: STATUSES }),
    onCreate,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [notesNlp(config)], selection: { anchor: doc.length } }),
    parent,
  })
  const setPeople = (next: Person[]) => {
    state.people = next
    listeners.forEach((l) => l())
  }
  return { view, onCreate, setPeople }
}

/** Types `text` at the caret as keystrokes (one `input.type` transaction each). */
function type(v: EditorView, text: string) {
  for (const ch of text) {
    const at = v.state.selection.main.head
    v.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: 'input.type' })
  }
}

function key(v: EditorView, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
  v.contentDOM.dispatchEvent(e)
  return e
}

const popup = (v: EditorView) => v.state.field(notesPopupField)

describe('notes autocomplete — opening and closing', () => {
  it('opens on typing a trigger, on the caret line', () => {
    const { view: v } = setup('# Weekly sync\n- Call ')
    type(v, '@')
    const p = popup(v)
    expect(p?.view.header).toBe('People')
    expect(p?.lineFrom).toBe(v.state.doc.line(2).from)
    expect(p?.view.rows.map((r) => (r.kind === 'entity' ? r.item.name : r.kind))).toEqual(['Anna', 'Dana Kim'])
  })

  it('does not open when the caret merely moves onto a token', () => {
    const { view: v } = setup('- Call @Anna /due fri\n')
    v.dispatch({ selection: { anchor: 9 } })
    expect(popup(v)).toBeNull()
  })

  it('re-evaluates on caret moves while open, closing outside a trigger', () => {
    const { view: v } = setup('- Call ')
    type(v, '@An')
    expect(popup(v)).not.toBeNull()
    v.dispatch({ selection: { anchor: 2 } })
    expect(popup(v)).toBeNull()
  })

  it('closes on an edit that is not typing (toolbar, paste, external value)', () => {
    const { view: v } = setup('- Call ')
    type(v, '@')
    v.dispatch({ changes: { from: 0, insert: '# ' } })
    expect(popup(v)).toBeNull()
  })

  it('a heading being typed (`##`) shows nothing to create', () => {
    const { view: v } = setup('')
    type(v, '##')
    expect(popup(v)).toBeNull()
  })
})

describe('notes autocomplete — keys', () => {
  it('↓ then ⏎ picks the row, inserts the canonical token and no newline', () => {
    const { view: v } = setup('- Call ')
    type(v, '@')
    expect(key(v, 'ArrowDown').defaultPrevented).toBe(true)
    expect(popup(v)?.selectedIndex).toBe(1)
    key(v, 'ArrowDown') // no wrap
    expect(popup(v)?.selectedIndex).toBe(1)
    key(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- Call @"Dana Kim" ')
    expect(v.state.selection.main.head).toBe(v.state.doc.length)
    expect(popup(v)).toBeNull()
  })

  it('Tab picks too (no tab inserted)', () => {
    const { view: v } = setup('- Plan ')
    type(v, '#q')
    key(v, 'Tab')
    expect(v.state.doc.toString()).toBe('- Plan #q4 ')
  })

  it('Esc closes only the popup: the host never sees it, the text stays', () => {
    const hostEsc = vi.fn()
    document.addEventListener('keydown', hostEsc, true)
    try {
      const { view: v } = setup('- Call ')
      type(v, '@An')
      key(v, 'Escape')
      expect(popup(v)).toBeNull()
      expect(hostEsc).not.toHaveBeenCalled()
      expect(v.state.doc.toString()).toBe('- Call @An')
      // Closed: the next Escape is the host's.
      key(v, 'Escape')
      expect(hostEsc).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', hostEsc, true)
    }
  })

  it('keys pass through while the popup is closed', () => {
    const { view: v } = setup('- Call ')
    expect(key(v, 'ArrowDown').defaultPrevented).toBe(false)
  })
})

describe('notes autocomplete — commands and create', () => {
  it('/ lists commands; an argument command goes on to its argument state', () => {
    const { view: v } = setup('- Renew domain ')
    type(v, '/du')
    expect(popup(v)?.view.header).toBe('Commands')
    key(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- Renew domain /due ')
    expect(popup(v)?.view.header).toBe('Due date')
    type(v, 'fri')
    expect(popup(v)?.view.rows[0]?.kind).toBe('parsed')
    key(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- Renew domain /due fri ')
    expect(popup(v)).toBeNull()
  })

  it('/status quotes a multi-word status', () => {
    const { view: v } = setup('- Ship ')
    type(v, '/status in')
    key(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- Ship /status "In progress" ')
  })

  it('picking a create row inserts the token and creates the entity at once', () => {
    const { view: v, onCreate } = setup('- Call legal ')
    type(v, '@Marco')
    key(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- Call legal @Marco ')
    expect(onCreate).toHaveBeenCalledWith('@', 'Marco')
  })

  it('replaces only the token when text follows the caret', () => {
    const { view: v } = setup('- Call  later')
    v.dispatch({ selection: { anchor: 7 } })
    type(v, '@an')
    key(v, 'Enter')
    expect(v.state.doc.toString()).toBe('- Call @Anna later')
  })
})

describe('notes autocomplete — the highlighted row is what you get', () => {
  it('a space typed after the token completes it to the highlighted person', () => {
    const { view: v, onCreate } = setup('- Call ')
    type(v, '@an')
    type(v, ' ')
    expect(v.state.doc.toString()).toBe('- Call @Anna ')
    expect(v.state.selection.main.head).toBe(13)
    expect(popup(v)).toBeNull()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('the pointer moves the highlight; typing on then uses that row', () => {
    const { view: v } = setup('- Call ')
    type(v, '@an') // Anna, Dana Kim
    highlightNotesPopupRow(v, 1)
    expect(popup(v)?.selectedIndex).toBe(1)
    type(v, ',')
    expect(v.state.doc.toString()).toBe('- Call @"Dana Kim",')
  })

  it('moving the caret off the token completes it', () => {
    const { view: v } = setup('- Call ')
    type(v, '@an')
    v.dispatch({ selection: { anchor: 2 } })
    expect(v.state.doc.toString()).toBe('- Call @Anna')
    expect(v.state.selection.main.head).toBe(2)
  })

  it('a highlighted create row leaves the text as typed — a typed space never creates', () => {
    const { view: v, onCreate } = setup('- Call ')
    type(v, '@zed ')
    expect(v.state.doc.toString()).toBe('- Call @zed ')
    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe('notes token tints', () => {
  const tints = (v: EditorView) =>
    [...v.contentDOM.querySelectorAll<HTMLElement>('.cm-nlp-tint')].map((el) => `${el.textContent}:${el.dataset.tint}`)

  it('tints recognised tokens per line with the Quick Add kinds', () => {
    const { view: v } = setup('- Draft @Anna #q4 /due fri /urgent\n- Call @Marco /status Nope\nplain a/b line')
    expect(tints(v)).toEqual([
      '@Anna:chip', '#q4:chip', '/due fri:due', '/urgent:urgent',
      '@Marco:new', '/status Nope:error',
    ])
  })

  it('an email address is plain text, not a mention', () => {
    const { view: v } = setup('- Mail bob@acme.com and (@Anna) with @Anna')
    expect(tints(v)).toEqual(['@Anna:chip'])
  })

  it('typing `@` inside a word opens no popup', () => {
    const { view: v } = setup('- Mail bob')
    type(v, '@ac')
    expect(popup(v)).toBeNull()
  })

  it('re-tints when the people change (a created person stops reading as new)', async () => {
    const { view: v, setPeople } = setup('- Call @Marco')
    expect(tints(v)).toEqual(['@Marco:new'])
    setPeople([...PEOPLE, { id: 3, name: 'Marco', initials: 'MA' }])
    await Promise.resolve()
    expect(tints(v)).toEqual(['@Marco:chip'])
  })
})

describe('notes autocomplete — a row’s person / tag menu holds the popup', () => {
  it('losing focus closes the popup, except while held; closing it releases the hold', () => {
    const { view: v } = setup('- Call ')
    type(v, '@')
    expect(popup(v)).not.toBeNull()
    expect(notesPopupFocusEffect(v.state, false)?.is(closeNotesPopup)).toBe(true)
    expect(notesPopupFocusEffect(v.state, true)).toBeNull()

    v.dispatch({ effects: holdNotesPopup.of(true) })
    expect(notesPopupFocusEffect(v.state, false)).toBeNull()
    expect(popup(v)).not.toBeNull()
    expect(v.state.doc.toString()).toBe('- Call @')

    // The focus coming back ends the hold.
    const back = notesPopupFocusEffect(v.state, true)
    expect(back?.is(holdNotesPopup) && back.value).toBe(false)
    if (back) v.dispatch({ effects: back })
    expect(notesPopupFocusEffect(v.state, false)?.is(closeNotesPopup)).toBe(true)
    // Closing the popup also drops a hold.
    v.dispatch({ effects: holdNotesPopup.of(true) })
    v.dispatch({ effects: closeNotesPopup.of(null) })
    expect(notesPopupFocusEffect(v.state, false)?.is(closeNotesPopup)).toBe(true)
  })
})
