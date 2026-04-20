import { useCallback } from 'react'
import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { formatShortcut } from '../../../utils/platform'
import styles from './NotesToolbar.module.css'

interface NotesToolbarProps {
  viewRef: { current: EditorView | null }
  onCopy: () => void
  copying?: boolean
  /** Convert the current line/block into a task. Hidden when omitted. */
  onConvertToTask?: () => void
  canConvertToTask?: boolean
  /** Pre-formatted platform-aware shortcut label (e.g. "⌥T", "Alt+T"). */
  convertShortcutLabel?: string
}

/**
 * Inline formatting row above `NotesEditor`. Every command is a CM dispatch
 * against the editor held in `viewRef`, so the toolbar is presentation-only —
 * no knowledge of the backing note source. `onCopy` is owned by the parent
 * (it needs the current content string + the note-store flush hook).
 */
export function NotesToolbar({ viewRef, onCopy, copying = false, onConvertToTask, canConvertToTask = false, convertShortcutLabel }: NotesToolbarProps) {
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
      {onConvertToTask && (
        <button
          type="button"
          className={styles.btn}
          onClick={onConvertToTask}
          disabled={!canConvertToTask}
          title={convertShortcutLabel ? `Convert line to task (${convertShortcutLabel})` : 'Convert line to task'}
          aria-label="Convert line to task"
        >
          → ✓
        </button>
      )}
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
