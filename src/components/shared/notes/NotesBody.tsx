import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { useNoteStore } from '../../../stores/note-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useTodoStore } from '../../../stores/todo-store'
import { NotesEditor } from './NotesEditor'
import styles from './NotesBody.module.css'

interface NotesBodyProps {
  dock?: 'right' | 'bottom' | 'floating' | 'slot'
  onConvertToast?: (message: string) => void
}

const CONVERTIBLE_LINE_RE = /^(\s*)([—–\-•]|\[[ xX]\])(\s+)(.*)$/

function formatRelativeTime(from: Date | null, now: Date): string {
  if (!from) return ''
  const diff = Math.max(0, now.getTime() - from.getTime())
  const seconds = Math.round(diff / 1000)
  if (seconds < 5) return 'saved just now'
  if (seconds < 60) return `saved ${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `saved ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `saved ${hours}h ago`
  return from.toLocaleDateString()
}

/**
 * Presentation-neutral notes body used by the dashboard `NotesPanel` and
 * (in Phase 4E) the canvas rail Notes slot. Owns the editor, ⌘T conversion,
 * and the footer saved-time indicator — but not the outer chrome / dock
 * buttons, which each surface supplies.
 */
export function NotesBody({ dock = 'right', onConvertToast }: NotesBodyProps) {
  const activeId = useNoteStore((s) => s.activeId)
  const notes = useNoteStore((s) => s.notes)
  const lastSavedAt = useNoteStore((s) => s.lastSavedAt)
  const setContent = useNoteStore((s) => s.setContent)
  const load = useNoteStore((s) => s.load)

  const defaultProjectId = useSettingsStore((s) => s.defaultProjectId)
  const selectedCanvasId = useCanvasStore((s) => s.selectedCanvasId)
  const addTodo = useTodoStore((s) => s.add)

  const [, setTick] = useState(0)
  const [caretLine, setCaretLine] = useState(0)

  useEffect(() => {
    if (activeId == null) void load()
  }, [activeId, load])

  // Re-render the "saved Xm ago" footer once a minute while mounted.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const content = activeId != null ? (notes.get(activeId)?.content ?? '') : ''

  const handleChange = useCallback((next: string) => {
    if (activeId != null) setContent(activeId, next)
  }, [activeId, setContent])

  const convertLineToTask = useCallback(async (view: EditorView) => {
    if (activeId == null) return false
    const state = view.state
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    const match = line.text.match(CONVERTIBLE_LINE_RE)
    if (!match) return false
    const [, leading, , , rest] = match
    const title = rest.trim()
    if (!title) return false

    try {
      await addTodo(title, selectedCanvasId ?? undefined, defaultProjectId ?? undefined)
      onConvertToast?.('Converted line to task')
    } catch {
      onConvertToast?.('Failed to convert line')
      return true
    }

    // Replace the line's prefix with `✓ ` so the author sees it's been pulled.
    view.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: `${leading}✓ ${title}`,
      },
    })
    return true
  }, [activeId, addTodo, selectedCanvasId, defaultProjectId, onConvertToast])

  const extraKeymap = useMemo(
    () => [
      {
        key: 'Mod-t',
        run: (view: EditorView) => {
          void convertLineToTask(view)
          return true
        },
      },
    ],
    [convertLineToTask],
  )

  const now = new Date()
  const savedLabel = formatRelativeTime(lastSavedAt, now)

  const lines = content.split('\n')
  const currentLineText = lines[caretLine] ?? ''
  const canConvert = CONVERTIBLE_LINE_RE.test(currentLineText) && currentLineText.trim().length > 0

  return (
    <div className={`${styles.body} ${styles[`body_${dock}`] ?? ''}`}>
      <NotesEditor
        value={content}
        onChange={handleChange}
        onLineChange={setCaretLine}
        extraKeymap={extraKeymap}
        placeholder="Jot notes here…"
      />
      <div className={styles.footer}>
        <span className={styles.footerChip}>⌘T convert</span>
        <span className={styles.footerChip}>MD shorthand</span>
        {canConvert && <span className={styles.footerHint}>Press ⌘T to convert current line</span>}
        <span className={styles.footerSpacer} />
        <span className={styles.footerSaved}>{savedLabel}</span>
      </div>
    </div>
  )
}
