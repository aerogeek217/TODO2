import { EditorState, Facet, StateEffect, StateField, RangeSetBuilder, type Extension, type TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Person, Status } from '../../../models'
import {
  applyAutocompletePick,
  carrySelection,
  computeAutocomplete,
  implicitAccept,
  isSelectable,
  isVisible,
  type AutocompleteRow,
  type AutocompleteSources,
  type AutocompleteView,
} from '../../../services/nlp-autocomplete'
import { parseInput } from '../../../services/natural-language-parser'
import { resolveInput } from '../../../services/nlp-resolver'
import { tokenTints } from '../../../services/nlp-token-tints'

/**
 * The `@ # /` autocomplete and token tints for the notes editor, as a
 * CodeMirror extension over the same pure functions Quick Add uses
 * (`services/nlp-autocomplete`, `services/nlp-token-tints`). Each line is task
 * text of its own: the popup reads the caret line, tints are per line.
 *
 * - The popup opens on typing (not on caret moves, so arrowing through a note
 *   full of tokens never opens it); while open, caret moves re-evaluate it and
 *   any other edit (paste, toolbar, undo, an external value) closes it, as
 *   does losing focus — except to a row's person / tag menu and what it opens
 *   (`holdNotesPopup`, until the focus is back).
 * - While open, ↑/↓ (no wrap), ⏎/Tab (pick; never a newline or tab) and Esc
 *   (closes only the popup) are taken in a window capture listener, so no
 *   host's Escape / outside handlers see them.
 * - Picking a create row inserts the token and calls `onCreate` at once, so
 *   the person or tag exists before the line is converted.
 * - Typing on past an `@` / `#` token without picking (a space or punctuation
 *   right after it, the caret moved off it) completes it to the highlighted
 *   person / tag (`implicitAccept`, in a transaction filter); a highlighted
 *   create row, or a person / tag matched only at a word start or inside its
 *   name, leaves the text as typed — a typed space never creates.
 *
 * The popup itself is React (`NotesNlpPopup`), reading `notesPopupField`.
 */

export interface NotesNlpConfig {
  /** Autocomplete candidates and today, read on every evaluation. */
  sources: () => AutocompleteSources
  /** People and statuses for the tints (an unknown `@name` / `/status` tints differently). */
  resolverData: () => { people: Person[]; statuses: Status[] }
  /**
   * A create row was picked: create the person (`@`) or tag (`#`) now. A
   * rejection's message is meant for the user (`NotesEditor` shows it
   * through `onNlpError`).
   */
  onCreate: (trigger: '@' | '#', name: string) => Promise<void>
  /** Calls `listener` whenever the sources change; returns the unsubscribe. */
  subscribe?: (listener: () => void) => () => void
}

export interface NotesPopupState {
  view: AutocompleteView
  selectedIndex: number
  /** Doc offset of the caret line's start (the view's offsets are line-relative). */
  lineFrom: number
}

const notesNlpConfig = Facet.define<NotesNlpConfig, NotesNlpConfig | null>({
  combine: (values) => values[0] ?? null,
})

/** Closes the popup. */
export const closeNotesPopup = StateEffect.define<null>()
/** Re-evaluates the popup at the caret (after a pick that goes on to an argument). */
const reopenNotesPopup = StateEffect.define<null>()
/** Moves the active row. */
const setNotesPopupIndex = StateEffect.define<number>()
/** The sources changed: re-read them (tints, an open popup). */
export const refreshNotesNlp = StateEffect.define<null>()
/**
 * A row's person / tag menu opened (`true`): the popup stays open though the
 * editor loses the focus to the menu, or to the editor / confirm it opens,
 * until the focus comes back to the editor (or `false`, or the popup closes).
 */
export const holdNotesPopup = StateEffect.define<boolean>()

/** Whether a row's menu holds the popup open (see `holdNotesPopup`). */
const notesPopupHeld = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(holdNotesPopup)) value = e.value
      if (e.is(closeNotesPopup)) value = false
    }
    return value
  },
})

function evaluate(state: EditorState, prev: NotesPopupState | null): NotesPopupState | null {
  const config = state.facet(notesNlpConfig)
  const sel = state.selection.main
  if (!config || !sel.empty) return null
  const line = state.doc.lineAt(sel.head)
  const view = computeAutocomplete(line.text, sel.head - line.from, config.sources())
  if (!isVisible(view)) return null
  const same = prev?.lineFrom === line.from ? prev : null
  return { view, lineFrom: line.from, selectedIndex: carrySelection(same?.view, same?.selectedIndex ?? 0, view) }
}

/** The open popup (null when closed). */
export const notesPopupField = StateField.define<NotesPopupState | null>({
  create: () => null,
  update(value, tr) {
    let next = value
    let reevaluate = false
    for (const e of tr.effects) {
      if (e.is(closeNotesPopup)) return null
      if (e.is(reopenNotesPopup)) reevaluate = true
      if (e.is(refreshNotesNlp) && value) reevaluate = true
      if (e.is(setNotesPopupIndex) && next) {
        next = { ...next, selectedIndex: Math.max(0, Math.min(e.value, next.view.rows.length - 1)) }
      }
    }
    const typed = tr.docChanged && (tr.isUserEvent('input.type') || tr.isUserEvent('delete'))
    if (typed || reevaluate) return evaluate(tr.state, next)
    if (!next) return null
    if (tr.docChanged) return null
    if (tr.selection) return evaluate(tr.state, next)
    return next
  },
})

/** Picks `row` in the open popup: inserts the token (and creates the entity for a create row). */
export function pickNotesPopupRow(view: EditorView, row: AutocompleteRow): boolean {
  const popup = view.state.field(notesPopupField, false)
  const config = view.state.facet(notesNlpConfig)
  if (!popup || !config) return false
  const line = view.state.doc.lineAt(popup.lineFrom)
  const pick = applyAutocompletePick(line.text, popup.view, row)
  if (!pick) return false
  // `pick.value` = text before the token + insert + ' ' + the rest (one
  // leading space of the rest dropped): replace just the token.
  const ate = line.text.charAt(popup.view.to) === ' ' ? 1 : 0
  view.dispatch({
    changes: {
      from: line.from + popup.view.from,
      to: line.from + popup.view.to + ate,
      insert: pick.value.slice(popup.view.from, pick.cursor),
    },
    selection: { anchor: line.from + pick.cursor },
    effects: pick.reopen ? reopenNotesPopup.of(null) : closeNotesPopup.of(null),
    userEvent: 'input.complete',
    scrollIntoView: true,
  })
  if (row.kind === 'create') void config.onCreate(row.trigger, row.name)
  return true
}

/** Makes row `index` the highlighted one (the pointer moved over it). */
export function highlightNotesPopupRow(view: EditorView, index: number): void {
  const popup = view.state.field(notesPopupField, false)
  if (!popup || popup.selectedIndex === index || !isSelectable(popup.view.rows[index])) return
  view.dispatch({ effects: setNotesPopupIndex.of(index) })
}

/**
 * Typing on past an open `@` / `#` popup (a typed character, or a caret
 * move): the token is completed to the highlighted person / tag in the same
 * step (`implicitAccept`).
 */
const implicitAcceptFilter = EditorState.transactionFilter.of((tr) => {
  const popup = tr.startState.field(notesPopupField, false)
  const config = tr.startState.facet(notesNlpConfig)
  if (!popup || !config || popup.view.mode !== 'entity') return tr
  if (tr.docChanged ? !tr.isUserEvent('input.type') : !tr.selection) return tr
  const before = tr.startState.doc.lineAt(popup.lineFrom).text
  const line = tr.newDoc.lineAt(tr.changes.mapPos(popup.lineFrom))
  const head = tr.newSelection.main.head
  const onLine = head >= line.from && head <= line.to
  const cursor = onLine ? head - line.from : -1
  const next = onLine ? computeAutocomplete(line.text, cursor, config.sources()) : null
  const done = implicitAccept({ value: before, view: popup.view, index: popup.selectedIndex }, line.text, cursor, next)
  if (!done) return tr
  const { from, to } = popup.view
  const insert = done.value.slice(from, to + done.value.length - line.text.length)
  const complete: TransactionSpec = {
    changes: { from: line.from + from, to: line.from + to, insert },
    sequential: true,
    userEvent: 'input.complete',
  }
  return [tr, complete]
})

/** Popup keys, ahead of every other handler while the popup is open. */
const popupKeys = ViewPlugin.fromClass(class {
  private readonly win: Window | null
  constructor(private readonly view: EditorView) {
    this.win = view.dom.ownerDocument.defaultView
    this.win?.addEventListener('keydown', this.onKey, true)
  }
  destroy() {
    this.win?.removeEventListener('keydown', this.onKey, true)
  }
  onKey = (e: KeyboardEvent) => {
    const popup = this.view.state.field(notesPopupField, false)
    if (!popup || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    if (!(e.target instanceof Node) || !this.view.contentDOM.contains(e.target)) return
    const rows = popup.view.rows
    let handled = true
    switch (e.key) {
      case 'ArrowDown':
        this.view.dispatch({ effects: setNotesPopupIndex.of(popup.selectedIndex + 1) })
        break
      case 'ArrowUp':
        this.view.dispatch({ effects: setNotesPopupIndex.of(popup.selectedIndex - 1) })
        break
      case 'Enter':
      case 'Tab': {
        const row = rows[popup.selectedIndex]
        if (row && isSelectable(row)) pickNotesPopupRow(this.view, row)
        break // never a newline / tab while open
      }
      case 'Escape':
        this.view.dispatch({ effects: closeNotesPopup.of(null) })
        break
      default:
        handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
})

const tintMark = new Map<string, Decoration>()
function markFor(tint: string): Decoration {
  let mark = tintMark.get(tint)
  if (!mark) {
    mark = Decoration.mark({ class: 'cm-nlp-tint', attributes: { 'data-tint': tint } })
    tintMark.set(tint, mark)
  }
  return mark
}

const MAYBE_TOKEN = /[@#/]/

function buildTints(view: EditorView): DecorationSet {
  const config = view.state.facet(notesNlpConfig)
  const builder = new RangeSetBuilder<Decoration>()
  if (!config) return builder.finish()
  const { people, statuses } = config.resolverData()
  const { today } = config.sources()
  const popup = view.state.field(notesPopupField, false)
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      if (MAYBE_TOKEN.test(line.text)) {
        const parsed = parseInput(line.text, today)
        const resolved = resolveInput(parsed, people, statuses)
        const active = popup && popup.lineFrom === line.from
          ? { start: popup.view.anchor, end: popup.view.to, error: popup.view.rows.some((r) => r.kind === 'error') }
          : undefined
        for (const s of tokenTints(parsed, resolved, active)) {
          if (s.end > s.start) builder.add(line.from + s.start, line.from + s.end, markFor(s.tint))
        }
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

/** Token tints (Quick Add's colours), per visible line. */
const tints = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  private readonly unsubscribe: (() => void) | undefined
  constructor(view: EditorView) {
    this.decorations = buildTints(view)
    const config = view.state.facet(notesNlpConfig)
    // The stores change outside the editor: re-tint (a created person stops
    // reading as new) and re-read an open popup.
    this.unsubscribe = config?.subscribe?.(() => {
      queueMicrotask(() => {
        if (view.dom.isConnected) view.dispatch({ effects: refreshNotesNlp.of(null) })
      })
    })
  }
  update(u: ViewUpdate) {
    if (
      u.docChanged ||
      u.viewportChanged ||
      u.startState.field(notesPopupField, false) !== u.state.field(notesPopupField, false) ||
      u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshNotesNlp)))
    ) {
      this.decorations = buildTints(u.view)
    }
  }
  destroy() {
    this.unsubscribe?.()
  }
}, { decorations: (p) => p.decorations })

/**
 * What a focus change does to the popup: losing the focus closes it unless a
 * row's menu holds it; getting it back ends the hold.
 */
export function notesPopupFocusEffect(state: EditorState, focusing: boolean): StateEffect<null> | StateEffect<boolean> | null {
  const held = state.field(notesPopupHeld, false)
  if (focusing) return held ? holdNotesPopup.of(false) : null
  return held ? null : closeNotesPopup.of(null)
}

/** The notes `@ # /` popup state, keys and token tints. */
export function notesNlp(config: NotesNlpConfig): Extension {
  return [
    notesNlpConfig.of(config),
    notesPopupField,
    notesPopupHeld,
    popupKeys,
    implicitAcceptFilter,
    tints,
    EditorView.focusChangeEffect.of(notesPopupFocusEffect),
  ]
}
