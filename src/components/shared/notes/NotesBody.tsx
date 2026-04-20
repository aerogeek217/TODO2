import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { useNoteStore } from '../../../stores/note-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useCanvasStore } from '../../../stores/canvas-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useProjectStore } from '../../../stores/project-store'
import { AppView, type PersistedTodoItem } from '../../../models'
import { formatShortcut } from '../../../utils/platform'
import { getFilterDefaults, supplementWithFilterDefaults } from '../../../utils/filter-defaults'
import { parseTaskInput, applyNlpMetadata } from '../../../services/nlp-task-creator'
import { copyNotesRich } from '../../../services/notes-export'
import { NotesEditor } from './NotesEditor'
import { NotesToolbar } from './NotesToolbar'
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
  /**
   * External content source (task notes, etc.). When supplied, the note-store
   * bindings are bypassed entirely — the editor reads `source.get()` and
   * writes via `source.set()`. `source.flush` is awaited before copy-rich.
   */
  source?: NotesSource
  /** Placeholder text for the editor. */
  placeholder?: string
}

const LINE_PREFIX_RE = /^(\s*)(?:(?:[—–\-•]|\[[ xX]\])\s+)?(.*)$/
const ALREADY_CONVERTED_RE = /^\s*✓\s/

/**
 * Presentation-neutral notes body used by the dashboard Notes tile, the
 * canvas rail Notes slot, and task note popovers. Owns the editor + Alt-T
 * convert action; the outer chrome is supplied by each surface.
 */
export function NotesBody({ dock = 'right', onConvertToast, showToolbar = true, activeIdOverride, source, placeholder }: NotesBodyProps) {
  const storeActiveId = useNoteStore((s) => s.activeId)
  const activeId = activeIdOverride !== undefined ? activeIdOverride : storeActiveId
  const notes = useNoteStore((s) => s.notes)
  const storeSetContent = useNoteStore((s) => s.setContent)
  const load = useNoteStore((s) => s.load)
  const storeFlush = useNoteStore((s) => s.flush)

  const defaultProjectId = useSettingsStore((s) => s.defaultProjectId)
  const selectedCanvasId = useCanvasStore((s) => s.selectedCanvasId)
  const addTodo = useTodoStore((s) => s.add)
  const updateTodo = useTodoStore((s) => s.update)
  const assignPerson = usePersonStore((s) => s.assignPerson)
  const assignOrg = useOrgStore((s) => s.assignOrg)

  const [caretLine, setCaretLine] = useState(0)
  const [copying, setCopying] = useState(false)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    // Only auto-seed the global note when no override was specified and
    // we aren't bound to an external source.
    if (source == null && activeIdOverride === undefined && activeId == null) void load()
  }, [activeId, activeIdOverride, load, source])

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

  const convertLineToTask = useCallback(async (view: EditorView) => {
    if (source == null && activeId == null) return false
    const state = view.state
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    if (ALREADY_CONVERTED_RE.test(line.text)) return false
    const match = line.text.match(LINE_PREFIX_RE)
    if (!match) return false
    const [, leading, rawRest] = match
    const rawTitle = rawRest.trim()
    if (!rawTitle) return false

    // Parse line via NLP + apply active filter defaults (matches CanvasPage's
    // handleAddTask path). Filter defaults are skipped on views without a
    // visible filter bar, matching TaskEditPopup's create-mode rule.
    const people = usePersonStore.getState().people
    const orgs = useOrgStore.getState().orgs
    const projects = useProjectStore.getState().projects
    const { title: parsedTitle, resolved } = parseTaskInput(rawTitle, people, projects, orgs)
    const activeView = useUIStore.getState().activeView
    const applyFilters = activeView !== AppView.Dashboard && activeView !== AppView.Settings
    const fd = applyFilters ? getFilterDefaults(useFilterStore.getState().filters) : null
    if (fd) supplementWithFilterDefaults(resolved, fd)
    const effectiveTitle = parsedTitle || rawTitle
    const pid = resolved.projectId ?? defaultProjectId ?? undefined

    let newId: number
    try {
      newId = await addTodo(effectiveTitle, selectedCanvasId ?? undefined, pid)
    } catch {
      onConvertToast?.('Failed to convert line')
      return true
    }

    try {
      await applyNlpMetadata(
        newId,
        resolved,
        (tid) => useTodoStore.getState().todos.find((t) => t.id === tid) as PersistedTodoItem | undefined,
        updateTodo,
        assignPerson,
        assignOrg,
      )
      // Filter-inferred status only applies when no settings default pre-filled
      // the row (matching TaskEditPopup's priority: settings default wins).
      if (fd?.statusId != null && useSettingsStore.getState().defaultStatusId == null) {
        const todo = useTodoStore.getState().todos.find((t) => t.id === newId) as PersistedTodoItem | undefined
        if (todo) await updateTodo({ ...todo, statusId: fd.statusId })
      }
    } catch {
      // Task was created; metadata failure is non-fatal for the user flow.
    }
    onConvertToast?.('Converted line to task')

    // Replace the line's prefix with `✓ ` so the author sees it's been pulled.
    view.dispatch({
      changes: {
        from: line.from,
        to: line.to,
        insert: `${leading}✓ ${effectiveTitle}`,
      },
    })
    return true
  }, [activeId, addTodo, updateTodo, assignPerson, assignOrg, selectedCanvasId, defaultProjectId, onConvertToast, source])

  const extraKeymap = useMemo(
    () => [
      {
        key: 'Alt-t',
        run: (view: EditorView) => {
          void convertLineToTask(view)
          return true
        },
      },
    ],
    [convertLineToTask],
  )

  const lines = content.split('\n')
  const currentLineText = lines[caretLine] ?? ''
  const canConvert = currentLineText.trim().length > 0 && !ALREADY_CONVERTED_RE.test(currentLineText)
  const convertShortcut = formatShortcut('Alt-t')

  const handleConvertClick = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    void convertLineToTask(view)
    view.focus()
  }, [convertLineToTask])

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
    <div className={`${styles.body} ${styles[`body_${dock}`] ?? ''}`}>
      {showToolbar && (
        <NotesToolbar
          viewRef={viewRef}
          onCopy={handleCopy}
          copying={copying}
          onConvertToTask={handleConvertClick}
          canConvertToTask={canConvert}
          convertShortcutLabel={convertShortcut}
        />
      )}
      <NotesEditor
        value={content}
        onChange={handleChange}
        onLineChange={setCaretLine}
        extraKeymap={extraKeymap}
        placeholder={placeholder ?? 'Jot notes here…'}
        viewRef={viewRef}
      />
    </div>
  )
}
