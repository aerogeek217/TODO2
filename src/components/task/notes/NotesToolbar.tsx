import { useCallback } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { listKindChange, listKindOf, type ListKind } from '../../../services/note-lines'
import { indentSelection } from './notes-indent'
import { useTooltip } from '../../shared/use-tooltip'
import styles from './NotesToolbar.module.css'

/** The toolbar's Convert button: the bullet lines in scope and what to do with them. */
export interface NotesConvertControl {
  /** Bullet lines a click would convert. */
  count: number
  /** The scope is the selection (not the whole note). */
  selection: boolean
  /** Pre-formatted platform-aware Alt+T label (e.g. "⌥T", "Alt+T"). */
  shortcutLabel: string
  /** What the lines become. */
  target: 'task' | 'subtask'
  onClick: () => void
  /** Hover / focus: mark (true) or unmark (false) the lines in scope. */
  onShowScope: (show: boolean) => void
}

interface NotesToolbarProps {
  viewRef: { current: EditorView | null }
  onCopy: () => void
  copying?: boolean
  /** The Convert button. Hidden when omitted. */
  convert?: NotesConvertControl
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The button's tooltip (label + muted second line) and accessible name. */
function convertButtonText({ count, selection, shortcutLabel, target }: Pick<NotesConvertControl, 'count' | 'selection' | 'shortcutLabel' | 'target'>): { label: string; hint: string } {
  if (count === 0) {
    return {
      label: selection ? 'No bullet lines in the selection' : 'No bullet lines to convert',
      hint: 'Start lines with -, *, • or [ ]',
    }
  }
  if (selection) {
    return { label: `Convert ${plural(count, 'selected line', 'selected lines')} to ${target}s`, hint: 'Bullet lines in the selection only' }
  }
  return {
    label: `Convert ${plural(count, 'bullet line', 'bullet lines')} to ${target}s`,
    hint: `Select lines to convert only those · ${shortcutLabel} converts the current line`,
  }
}

/** An arrow into (or out of) an indented line: the toolbar's Indent / Outdent. */
function IndentGlyph({ out = false }: { out?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 3h11M7.5 8h6M7.5 13h6" />
      {out ? <path d="M5.5 5.5L3 8l2.5 2.5" /> : <path d="M2.5 5.5L5 8l-2.5 2.5" />}
    </svg>
  )
}

function ConvertGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4h6M2.5 7.5h4" />
      <rect x="8.5" y="8" width="5.5" height="5.5" rx="1.4" />
      <path d="M9.9 10.8l1.1 1.1 1.8-2" />
    </svg>
  )
}

function ConvertButton({ convert }: { convert: NotesConvertControl }) {
  const { count, selection, onClick, onShowScope } = convert
  const { label, hint } = convertButtonText(convert)
  const { triggerProps, tooltip } = useTooltip(`${label}\n${hint}`)
  const disabled = count === 0
  return (
    <button
      type="button"
      className={styles.convertBtn}
      aria-disabled={disabled}
      aria-label={label}
      data-selection={selection ? 'true' : undefined}
      // Keep the editor's selection: the scope is what's selected.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { if (!disabled) onClick() }}
      {...triggerProps}
      onPointerEnter={(e) => { triggerProps.onPointerEnter?.(e); onShowScope(true) }}
      onPointerLeave={() => { triggerProps.onPointerLeave?.(); onShowScope(false) }}
      onFocus={(e) => { triggerProps.onFocus?.(e); onShowScope(true) }}
      onBlur={() => { triggerProps.onBlur?.(); onShowScope(false) }}
    >
      <ConvertGlyph />
      <span className={styles.convertLabel}>Convert</span>
      {!disabled && <span className={styles.convertBadge}>{count}</span>}
      {tooltip}
    </button>
  )
}

/**
 * Inline formatting row above `NotesEditor`. Every command is a CM dispatch
 * against the editor held in `viewRef`, so the toolbar is presentation-only —
 * no knowledge of the backing note source. `onCopy` is owned by the parent
 * (it needs the current content string + the note-store flush hook).
 */
export function NotesToolbar({ viewRef, onCopy, copying = false, convert }: NotesToolbarProps) {
  // The bullet and box buttons. A line of that kind goes back to plain text; a
  // line of the other kind, or none, becomes that kind. Over several lines,
  // all of that kind go back, else all become it; blank lines are left alone.
  const toggleList = useCallback((kind: ListKind) => {
    const view = viewRef.current
    if (!view) return
    const { doc, selection } = view.state
    const { from, to, empty } = selection.main
    const first = doc.lineAt(from).number
    const last = doc.lineAt(to).number
    const lines = Array.from({ length: last - first + 1 }, (_, i) => doc.line(first + i))
      .filter((line) => first === last || line.text.trim() !== '')
    const next = lines.every((line) => listKindOf(line.text) === kind) ? null : kind
    const changes = lines.map((line) => {
      const change = listKindChange(line.text, next)
      return { from: line.from + change.from, to: line.from + change.to, insert: change.insert }
    })
    const [only] = changes
    // One line: the caret stays in the text, or starts it (an empty line, a new marker).
    const caret = empty && only && lines.length === 1
      ? { selection: EditorSelection.cursor(Math.max(only.from + only.insert.length, view.state.changes(changes).mapPos(from, 1))) }
      : {}
    view.dispatch({ changes, ...caret })
    view.focus()
  }, [viewRef])

  // The list lines under the selection move one level (cr28): what Tab / ⇧Tab do, from a button.
  const indent = useCallback((direction: 'in' | 'out') => {
    const view = viewRef.current
    if (!view) return
    indentSelection(view, direction)
    view.focus()
  }, [viewRef])

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Notes formatting">
      <button
        type="button"
        className={styles.btn}
        onClick={() => toggleList('bullet')}
        title="Bullet list"
        aria-label="Bullet list"
      >
        •
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => toggleList('box')}
        title="Checkbox"
        aria-label="Checkbox"
      >
        ☐
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => indent('out')}
        title="Outdent list line (Shift+Tab)"
        aria-label="Outdent"
      >
        <IndentGlyph out />
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => indent('in')}
        title="Indent list line (Tab)"
        aria-label="Indent"
      >
        <IndentGlyph />
      </button>
      <span className={styles.spacer} />
      {convert && <ConvertButton convert={convert} />}
      <button
        type="button"
        className={styles.copyBtn}
        onClick={onCopy}
        disabled={copying}
        title="Copy as rich text for OneNote / Word"
        aria-label="Copy as rich text"
      >
        ⧉
      </button>
    </div>
  )
}
