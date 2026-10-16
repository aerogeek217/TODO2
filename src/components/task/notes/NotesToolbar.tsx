import { useCallback } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { formatShortcut } from '../../../utils/platform'
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
function convertButtonText({ count, selection, shortcutLabel }: Pick<NotesConvertControl, 'count' | 'selection' | 'shortcutLabel'>): { label: string; hint: string } {
  if (count === 0) {
    return {
      label: selection ? 'No bullet lines in the selection' : 'No bullet lines to convert',
      hint: 'Start lines with -, *, • or [ ]',
    }
  }
  if (selection) {
    return { label: `Convert ${plural(count, 'selected line', 'selected lines')} to tasks`, hint: 'Bullet lines in the selection only' }
  }
  return {
    label: `Convert ${plural(count, 'bullet line', 'bullet lines')} to tasks`,
    hint: `Select lines to convert only those · ${shortcutLabel} converts the current line`,
  }
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
  const wrapSelection = useCallback((marker: string) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to)
    if (from === to) {
      // Collapsed: insert markers and place cursor between them.
      view.dispatch({
        changes: { from, to, insert: `${marker}${marker}` },
        selection: { anchor: from + marker.length },
      })
    } else {
      view.dispatch({
        changes: { from, to, insert: `${marker}${selected}${marker}` },
        selection: { anchor: from + marker.length, head: from + marker.length + selected.length },
      })
    }
    view.focus()
  }, [viewRef])

  const prefixLines = useCallback((prefix: string, { replaceHeading = false } = {}) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const startLine = view.state.doc.lineAt(from)
    const endLine = view.state.doc.lineAt(to)
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = view.state.doc.line(n)
      let text = line.text
      if (replaceHeading) {
        text = text.replace(/^#{1,6}\s+/, '')
      }
      // Toggle: if the line already starts with the exact prefix, strip it.
      if (text.startsWith(prefix)) {
        const stripped = text.slice(prefix.length)
        changes.push({ from: line.from, to: line.to, insert: stripped })
      } else {
        changes.push({ from: line.from, to: line.to, insert: `${prefix}${text}` })
      }
    }
    view.dispatch({ changes })
    // For single-line invocations (the common bullet / checkbox add on an
    // empty line), the caret would otherwise stay pinned at the original
    // offset — which is *before* the newly inserted prefix. Move it to the
    // end of the (now-prefixed) line so the user can just start typing.
    if (startLine.number === endLine.number) {
      const lineNow = view.state.doc.line(startLine.number)
      view.dispatch({ selection: EditorSelection.cursor(lineNow.to) })
    }
    view.focus()
  }, [viewRef])

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Notes formatting">
      <button
        type="button"
        className={styles.btn}
        onClick={() => wrapSelection('**')}
        title={`Bold (${formatShortcut('Mod-b')})`}
        aria-label="Bold"
      >
        <span className={styles.btnBold}>B</span>
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => wrapSelection('*')}
        title={`Italic (${formatShortcut('Mod-i')})`}
        aria-label="Italic"
      >
        <span className={styles.btnItalic}>I</span>
      </button>
      <span className={styles.sep} aria-hidden="true" />
      <button
        type="button"
        className={styles.btn}
        onClick={() => prefixLines('# ', { replaceHeading: true })}
        title="Heading 1"
        aria-label="Heading 1"
      >
        H1
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => prefixLines('## ', { replaceHeading: true })}
        title="Heading 2"
        aria-label="Heading 2"
      >
        H2
      </button>
      <span className={styles.sep} aria-hidden="true" />
      <button
        type="button"
        className={styles.btn}
        onClick={() => prefixLines('- ')}
        title="Bullet list"
        aria-label="Bullet list"
      >
        •
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => prefixLines('- [ ] ')}
        title="Checkbox"
        aria-label="Checkbox"
      >
        ☐
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
