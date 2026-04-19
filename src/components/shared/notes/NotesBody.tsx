import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { useNoteStore } from '../../../stores/note-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useTodoStore } from '../../../stores/todo-store'
import { formatShortcut } from '../../../utils/platform'
import { copyNotesRich } from '../../../services/notes-export'
import { NotesEditor } from './NotesEditor'
import { NotesToolbar } from './NotesToolbar'
import styles from './NotesBody.module.css'

interface NotesBodyProps {
  dock?: 'right' | 'bottom' | 'floating' | 'slot'
  onConvertToast?: (message: string) => void
  /** Show the inline formatting toolbar. Defaults to true. */
  showToolbar?: boolean
  /**
   * Override the note row this body edits. When provided (floating canvas
   * notes), reads/writes the referenced row instead of the store's global
   * `activeId`. Caller is responsible for ensuring the row is loaded.
   */
  activeIdOverride?: number | null
  /** Hide the footer chrome entirely (used by floating notes for a compact look). */
  hideFooter?: boolean
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
export function NotesBody({ dock = 'right', onConvertToast, showToolbar = true, activeIdOverride, hideFooter = false }: NotesBodyProps) {
  const storeActiveId = useNoteStore((s) => s.activeId)
  const activeId = activeIdOverride !== undefined ? activeIdOverride : storeActiveId
  const notes = useNoteStore((s) => s.notes)
  const lastSavedAt = useNoteStore((s) => s.lastSavedAt)
  const setContent = useNoteStore((s) => s.setContent)
  const load = useNoteStore((s) => s.load)
  const flush = useNoteStore((s) => s.flush)

  const defaultProjectId = useSettingsStore((s) => s.defaultProjectId)
  const selectedCanvasId = useCanvasStore((s) => s.selectedCanvasId)
  const addTodo = useTodoStore((s) => s.add)

  const [, setTick] = useState(0)
  const [caretLine, setCaretLine] = useState(0)
  const [copying, setCopying] = useState(false)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    // Only auto-seed the global note when no override was specified.
    if (activeIdOverride === undefined && activeId == null) void load()
  }, [activeId, activeIdOverride, load])

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
  const convertShortcut = formatShortcut('Mod-t')

  const handleCopy = useCallback(async () => {
    if (activeId == null) return
    setCopying(true)
    try {
      // Flush any pending debounced write so the copy reflects the latest keystrokes.
      await flush()
      const latest = useNoteStore.getState().notes.get(activeId)?.content ?? ''
      const ok = await copyNotesRich(latest)
      onConvertToast?.(ok ? 'Copied rich text — paste into OneNote/Word' : 'Copy failed')
    } finally {
      setCopying(false)
    }
  }, [activeId, flush, onConvertToast])

  return (
    <div className={`${styles.body} ${styles[`body_${dock}`] ?? ''}`}>
      {showToolbar && (
        <NotesToolbar viewRef={viewRef} onCopy={handleCopy} copying={copying} />
      )}
      <NotesEditor
        value={content}
        onChange={handleChange}
        onLineChange={setCaretLine}
        extraKeymap={extraKeymap}
        placeholder="Jot notes here…"
        viewRef={viewRef}
      />
      {!hideFooter && (
        <div className={styles.footer}>
          <span className={styles.footerChip}>{convertShortcut} convert</span>
          <span className={styles.footerChip}>MD shorthand</span>
          {canConvert && <span className={styles.footerHint}>Press {convertShortcut} to convert current line</span>}
          <span className={styles.footerSpacer} />
          <span className={styles.footerSaved}>{savedLabel}</span>
        </div>
      )}
    </div>
  )
}
