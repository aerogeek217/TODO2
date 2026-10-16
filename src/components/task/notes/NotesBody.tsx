import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { useNoteStore } from '../../../stores/note-store'
import { formatShortcut } from '../../../utils/platform'
import { copyNotesRich } from '../../../services/notes-export'
import { convertCandidates, selectionLines } from '../../../services/note-lines'
import { NotesEditor } from './NotesEditor'
import { NotesToolbar, type NotesConvertControl } from './NotesToolbar'
import { storeNotesNlpConfig } from './notes-nlp-stores'
import { showConvertScope } from './notes-convert-highlight'
import { useNotesConvert } from './NotesConvert'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import styles from './NotesBody.module.css'

/**
 * Pluggable content adapter. When provided, `NotesBody` reads/writes this
 * source instead of the note-store. `flush` is awaited before copy-rich.
 */
export interface NotesSource {
  get: () => string
  set: (next: string) => void
  flush?: () => Promise<void>
}

interface NotesBodyProps {
  onConvertToast?: (message: string) => void
  /** Show the inline formatting toolbar. Defaults to true. */
  showToolbar?: boolean
  /**
   * External content source (task notes, etc.). When supplied, the note-store
   * bindings are bypassed entirely — the editor reads `source.get()` and
   * writes via `source.set()`. `source.flush` is awaited before copy-rich.
   */
  source?: NotesSource
  /** Placeholder text for the editor. */
  placeholder?: string
  /** Notes → tasks (the toolbar's Convert and Alt+T). Defaults to true. */
  convert?: boolean
}

/**
 * Presentation-neutral notes body used by the notes widget, the task
 * editor's notes and task note popovers. Owns the editor and notes → tasks
 * (the toolbar's Convert, Alt+T — `useNotesConvert`); the outer chrome is
 * supplied by each surface.
 */
export function NotesBody({ onConvertToast, showToolbar = true, source, placeholder, convert = true }: NotesBodyProps) {
  const activeId = useNoteStore((s) => s.activeId)
  const notes = useNoteStore((s) => s.notes)
  const storeSetContent = useNoteStore((s) => s.setContent)
  const load = useNoteStore((s) => s.load)
  const storeFlush = useNoteStore((s) => s.flush)

  const [selection, setSelection] = useState<{ from: number; to: number }>({ from: 0, to: 0 })
  const [copying, setCopying] = useState(false)
  const viewRef = useRef<EditorView | null>(null)
  const toastRef = useLatestRef(onConvertToast)
  // `@ # /` popup + tints over the live stores (read once by the editor).
  const nlp = useMemo(() => storeNotesNlpConfig(), [])

  useEffect(() => {
    // Only auto-seed the global note when not bound to an external source.
    if (source == null && activeId == null) void load()
  }, [activeId, load, source])

  const content = source
    ? source.get()
    : activeId != null ? (notes.get(activeId)?.content ?? '') : ''

  const handleChange = useCallback((next: string) => {
    if (source) {
      source.set(next)
      return
    }
    if (activeId != null) storeSetContent(activeId, next)
  }, [source, activeId, storeSetContent])

  const contentRef = useLatestRef(content)
  const handleChangeRef = useLatestRef(handleChange)
  const notesConvert = useNotesConvert({
    viewRef,
    getText: useCallback(() => contentRef.current, [contentRef]),
    setText: useCallback((next: string) => handleChangeRef.current(next), [handleChangeRef]),
    onToast: useCallback((message: string) => toastRef.current?.(message), [toastRef]),
  })
  const { convertLine, convertScope } = notesConvert
  const canConvert = convert && (source != null || activeId != null)

  const extraKeymap = useMemo(
    () => (canConvert ? [{
      key: 'Alt-t',
      run: (view: EditorView) => {
        convertLine(view)
        return true
      },
    }] : []),
    [canConvert, convertLine],
  )

  // The bullet lines the toolbar's Convert would take: the selection's, or the note's.
  const scope = useMemo(() => {
    const range = selectionLines(content, selection.from, selection.to)
    return { lines: convertCandidates(content, range).map((c) => c.line), selection: range != null }
  }, [content, selection])
  const scopeRef = useLatestRef(scope)
  const convertShortcut = formatShortcut('Alt-t')
  const convertControl = useMemo<NotesConvertControl | undefined>(() => (canConvert ? {
    count: scope.lines.length,
    selection: scope.selection,
    shortcutLabel: convertShortcut,
    onClick: () => {
      showConvertScope(viewRef.current, [])
      convertScope()
    },
    onShowScope: (show) => showConvertScope(viewRef.current, show ? scopeRef.current.lines : []),
  } : undefined), [canConvert, scope, convertShortcut, convertScope, scopeRef])

  const handleCopy = useCallback(async () => {
    setCopying(true)
    try {
      // Flush any pending debounced write so the copy reflects the latest keystrokes.
      let latest: string
      if (source) {
        if (source.flush) await source.flush()
        latest = source.get()
      } else {
        if (activeId == null) return
        await storeFlush()
        latest = useNoteStore.getState().notes.get(activeId)?.content ?? ''
      }
      const ok = await copyNotesRich(latest)
      onConvertToast?.(ok ? 'Copied rich text — paste into OneNote/Word' : 'Copy failed')
    } finally {
      setCopying(false)
    }
  }, [source, activeId, storeFlush, onConvertToast])

  return (
    <div className={styles.body}>
      {showToolbar && (
        <NotesToolbar
          viewRef={viewRef}
          onCopy={handleCopy}
          copying={copying}
          convert={convertControl}
        />
      )}
      <NotesEditor
        value={content}
        onChange={handleChange}
        onSelectionChange={setSelection}
        extraKeymap={extraKeymap}
        placeholder={placeholder ?? 'Jot notes here…'}
        viewRef={viewRef}
        nlp={nlp}
        onNlpError={onConvertToast}
      />
      {notesConvert.layer}
    </div>
  )
}
