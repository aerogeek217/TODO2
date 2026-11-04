import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'
import { selectionLines, type LineRange, type TextChange } from '../../../services/note-lines'
import { notesPopupField } from './notes-nlp'

/**
 * Tab / ⇧Tab indent and outdent **list lines** in the notes editors (cr28,
 * design T6): a bullet (`- ` `* ` `• `), a box (`[ ] ` `- [x] `) or a
 * numbered item (`1. ` `1) `), two spaces per level, every line the
 * selection touches at once (the caret's line for an empty selection) —
 * and only when every one of them is a list line. Anywhere else Tab keeps
 * its old behaviour (the command returns false, so the key goes on to the
 * host: the focus leaves the editor), as it does while the `@ # ! /` popup
 * is open (the popup takes Tab to pick a row). Esc with no popup open arms
 * the next Tab to leave the editor too (`tabLeavesField`, cleared by any
 * typing or caret move), so the keyboard is never trapped on a list.
 */

export const INDENT = '  '

/** A list line: optional indent, then a bullet, a box or a number, then a space (or the end). */
const LIST_LINE_RE = /^\s*(?:[-*•](?:\s+\[[ xX]\])?|\[[ xX]\]|\d+[.)])(?:\s|$)/

export function isListLine(text: string): boolean {
  return LIST_LINE_RE.test(text)
}

/** Offsets where each line of `text` starts. */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return starts
}

/** The 1-based line holding offset `pos`. */
function lineAt(starts: readonly number[], pos: number): number {
  let n = 1
  while (n < starts.length && (starts[n] ?? Infinity) <= pos) n++
  return n
}

/** The lines a selection touches — the caret's line when it is empty. */
function linesOf(text: string, from: number, to: number): LineRange {
  const range = selectionLines(text, from, to)
  if (range) return range
  const line = lineAt(lineStarts(text), Math.min(from, to))
  return { from: line, to: line }
}

/**
 * The changes that indent every line the selection `from`–`to` touches by
 * one level, or null when one of them isn't a list line (the key is then
 * not ours).
 */
export function indentLines(text: string, from: number, to: number): TextChange[] | null {
  const lines = text.split('\n')
  const starts = lineStarts(text)
  const range = linesOf(text, from, to)
  const changes: TextChange[] = []
  for (let n = range.from; n <= range.to; n++) {
    const line = lines[n - 1] ?? ''
    if (!isListLine(line)) return null
    const start = starts[n - 1] ?? 0
    changes.push({ from: start, to: start, insert: INDENT })
  }
  return changes
}

/**
 * The changes that outdent every line the selection touches by one level
 * (up to two leading spaces, or one tab), or null when one of them isn't a
 * list line. A line with no indent left contributes no change.
 */
export function outdentLines(text: string, from: number, to: number): TextChange[] | null {
  const lines = text.split('\n')
  const starts = lineStarts(text)
  const range = linesOf(text, from, to)
  const changes: TextChange[] = []
  for (let n = range.from; n <= range.to; n++) {
    const line = lines[n - 1] ?? ''
    if (!isListLine(line)) return null
    const lead = /^(\t| {1,2})/.exec(line)?.[0]
    if (!lead) continue
    const start = starts[n - 1] ?? 0
    changes.push({ from: start, to: start + lead.length, insert: '' })
  }
  return changes
}

/** Arms (true) or disarms the next Tab leaving the editor. */
const setTabLeaves = StateEffect.define<boolean>()

/**
 * True after an Esc with no popup open: the next Tab / ⇧Tab leaves the
 * editor instead of indenting. Any typing or caret move disarms it.
 */
export const tabLeavesField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTabLeaves)) return e.value
    if (tr.docChanged || tr.selection) return false
    return value
  },
})

/** Tab: indent the list lines under the selection. */
export const indentListLines: Command = (view) => {
  if (view.state.field(notesPopupField, false) || view.state.field(tabLeavesField, false)) return false
  const { from, to } = view.state.selection.main
  const changes = indentLines(view.state.doc.toString(), from, to)
  if (!changes) return false
  view.dispatch({ changes, userEvent: 'input.indent' })
  return true
}

/** ⇧Tab: outdent the list lines under the selection. */
export const outdentListLines: Command = (view) => {
  if (view.state.field(notesPopupField, false) || view.state.field(tabLeavesField, false)) return false
  const { from, to } = view.state.selection.main
  const changes = outdentLines(view.state.doc.toString(), from, to)
  if (!changes) return false
  if (changes.length > 0) view.dispatch({ changes, userEvent: 'delete.dedent' })
  return true
}

/**
 * Esc with no popup open: the next Tab leaves. Returns false, so the key
 * goes on to every other binding and to the host (a dialog's Esc closes it).
 */
export const armTabLeave: Command = (view) => {
  if (view.state.field(notesPopupField, false)) return false
  view.dispatch({ effects: setTabLeaves.of(true) })
  return false
}

/** The indent commands and their field, for every notes editor. */
export const notesIndent: Extension = [
  tabLeavesField,
  Prec.high(keymap.of([
    { key: 'Tab', run: indentListLines },
    { key: 'Shift-Tab', run: outdentListLines },
    { key: 'Escape', run: armTabLeave },
  ])),
]
