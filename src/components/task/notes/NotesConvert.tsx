import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import type { TodoItem } from '../../../models'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { autoNextFollowup, useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { getFilterDefaults } from '../../../utils/filter-defaults'
import { startOfToday } from '../../../utils/date'
import {
  applyTextChanges,
  convertCandidates,
  locateLines,
  markLineChanges,
  removeLineChanges,
  selectionLines,
  singleLineCandidate,
  type ConvertLine,
  type TextChange,
} from '../../../services/note-lines'
import { draftFromEditor, draftFromText, type DraftContext, type TaskDraft } from '../../../services/task-draft'
import { createTasksFromDrafts } from '../../../services/note-tasks'
import { createTaskFromDraft } from '../../../services/create-task'
import { ConfirmDialog } from '../../shared/Dialog'
import { TaskEditPopup } from '../TaskEditPopup'
import { NotesConvertPreview, type PreviewRow } from './NotesConvertPreview'

/** Marks the body while any convert dialog is open (hosts ignore outside clicks / Esc then). */
export const NOTES_CONVERT_ATTR = 'data-notes-convert'

/** Whether a notes convert dialog (preview, task popup, remove prompt) is open. */
export function isNotesConvertOpen(): boolean {
  return document.querySelector(`[${NOTES_CONVERT_ATTR}]`) !== null
}

interface CreatedLine {
  line: ConvertLine
  id: number
  title: string
}

type ConvertState =
  | { kind: 'single'; line: ConvertLine; draft: TaskDraft }
  | {
    kind: 'preview'
    rows: PreviewRow[]
    fromSelection: boolean
    noteName: string | null
    leftOut: number
    editing: number | null
    focusKey: number | null
    busy: boolean
  }
  | { kind: 'prompt'; items: CreatedLine[]; leftOut: number }

function draftContext(): DraftContext {
  return {
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
    defaults: getFilterDefaults(useFilterStore.getState().filters),
    defaultStatusId: useSettingsStore.getState().defaultStatusId,
    today: new Date(),
  }
}

/** The note's name for the preview: its first line when that's a heading. */
export function noteNameOf(text: string): string | null {
  const first = text.split('\n').find((l) => l.trim() !== '')
  const name = first === undefined ? undefined : headingText(first)?.trim()
  if (!name) return null
  return name.length > 40 ? `${name.slice(0, 39)}…` : name
}

const SPACE = /\s/
const LINE_BREAK = /[\n\r\u2028\u2029]/

/**
 * What `/^\s*#{1,6}\s+(.+?)\s*#*\s*$/` captures from `line`, in linear time
 * (the regex backtracked cubically on a long space run — a note is
 * untrusted text when it was imported or synced).
 */
function headingText(line: string): string | null {
  const n = line.length
  const isSpace = (k: number) => SPACE.test(line.charAt(k))
  let i = 0
  while (i < n && isSpace(i)) i++
  const hashes = i
  while (i < n && line.charAt(i) === '#') i++
  if (i - hashes < 1 || i - hashes > 6) return null
  // The `\s+` run after the hashes: the capture starts at its end, or —
  // backing off — one character earlier each time.
  let w = i
  while (w < n && isSpace(w)) w++
  if (w === i) return null
  // Where the longest trailing `\s*#*\s*` starts: the capture (lazy) ends
  // there, or after its first character if it would be empty.
  let t = n
  while (t > i && isSpace(t - 1)) t--
  while (t > i && line.charAt(t - 1) === '#') t--
  while (t > i && isSpace(t - 1)) t--
  for (let c = w; c > i; c--) {
    if (c >= n) continue
    if (t > c + 1) {
      // `.` stops at a line break; an earlier start has the same end, so
      // it holds the same break too.
      const captured = line.slice(c, t)
      return LINE_BREAK.test(captured) ? null : captured
    }
    if (!LINE_BREAK.test(line.charAt(c))) return line.charAt(c)
  }
  return null
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export interface NotesConvertOptions {
  viewRef: { current: EditorView | null }
  /** The note's text and a writer, used when the editor is gone. */
  getText: () => string
  setText: (next: string) => void
  /**
   * Writes the note's typed text now: before a convert starts (what was typed
   * is its own edit) and after the convert changes the note (that change is
   * its own edit too).
   */
  flush?: () => void | Promise<void>
  onToast?: (message: string) => void
}

/**
 * Notes → tasks. `convertLine` (Alt+T) opens the task editor in create mode
 * for the caret line; `convertScope` (the toolbar's Convert) takes the
 * bullet lines of the note, or of the selection: two or more open the
 * preview, exactly one opens the editor like Alt+T. Created tasks turn
 * their lines into `✓ <title>`; after a preview the user picks Remove (the
 * lines go) or Keep (`✓`) — one editor transaction, so one Ctrl+Z in the
 * note undoes it. The task create is its own undo step (the snackbar's
 * Undo deletes the tasks and leaves the note as it is).
 */
export function useNotesConvert({ viewRef, getText, setText, flush, onToast }: NotesConvertOptions) {
  const [state, setState] = useState<ConvertState | null>(null)
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const followupInterval = useSettingsStore((s) => s.followupDefaultInterval)
  const autoFollowup = useSettingsStore((s) => s.autoFollowup)

  const currentText = useCallback(() => viewRef.current?.state.doc.toString() ?? getText(), [viewRef, getText])

  /** Applies changes computed from the note as it is now: one editor transaction. */
  const applyToNote = useCallback((compute: (text: string) => TextChange[]) => {
    const view = viewRef.current
    if (view) {
      const changes = compute(view.state.doc.toString())
      if (changes.length > 0) view.dispatch({ changes, userEvent: 'input.convert' })
    } else {
      const text = getText()
      const changes = compute(text)
      if (changes.length > 0) setText(applyTextChanges(text, changes))
    }
    void flush?.()
  }, [viewRef, getText, setText, flush])

  /** Rewrites converted lines as `✓ <title>`; returns how many couldn't be found. */
  const markConverted = useCallback((items: readonly { line: ConvertLine; title: string }[]) => {
    let missing = 0
    applyToNote((text) => {
      const found = locateLines(text, items.map((i) => i.line))
      missing = found.filter((n) => n == null).length
      return markLineChanges(text, items.flatMap((item, k) => {
        const line = found[k]
        return line != null ? [{ line, title: item.title }] : []
      }))
    })
    return missing
  }, [applyToNote])

  const close = useCallback(() => {
    setState(null)
    viewRef.current?.focus()
  }, [viewRef])

  const openSingle = useCallback((line: ConvertLine) => {
    void flush?.()
    setState({ kind: 'single', line, draft: draftFromText(line.body, draftContext()) })
  }, [flush])

  /** Alt+T: the caret line. False when it can't be converted (blank / already `✓`). */
  const convertLine = useCallback((view: EditorView): boolean => {
    if (state) return true
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const candidate = singleLineCandidate(line.text, line.number)
    if (!candidate) return false
    openSingle(candidate)
    return true
  }, [state, openSingle])

  /** The toolbar's Convert: the bullet lines of the note or the selection. */
  const convertScope = useCallback(() => {
    if (state) return
    const view = viewRef.current
    const text = currentText()
    const sel = view?.state.selection.main
    const range = sel ? selectionLines(text, sel.from, sel.to) : null
    const lines = convertCandidates(text, range)
    const [only] = lines
    if (lines.length === 1 && only) {
      openSingle(only)
      return
    }
    if (lines.length === 0) return
    void flush?.()
    const ctx = draftContext()
    setState({
      kind: 'preview',
      rows: lines.map((line, key) => ({ key, line, draft: draftFromText(line.body, ctx), edited: false })),
      fromSelection: range != null,
      noteName: noteNameOf(text),
      leftOut: 0,
      editing: null,
      focusKey: null,
      busy: false,
    })
  }, [state, viewRef, currentText, openSingle, flush])

  const editorCtx = useCallback(() => ({
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
    today: new Date(),
  }), [])

  // Single line: create, then mark the line `✓ <title>` (no prompt). Not
  // stored (the snackbar says so): null keeps the editor open and the line as
  // it is.
  const createSingle = useCallback(async (line: ConvertLine, partial: Partial<TodoItem>, assignments?: { personIds: number[]; tagIds: number[] }) => {
    const draft = draftFromEditor(partial, assignments ?? { personIds: [], tagIds: [] }, editorCtx())
    const id = await createTaskFromDraft(draft)
    if (id == null) return null
    useUIStore.getState().showRecentlyCreated(id)
    if (markConverted([{ line, title: draft.title }]) > 0) onToast?.('Task created — its line changed, so it was left as it is')
    return id
  }, [editorCtx, markConverted, onToast])

  const createAll = useCallback(async () => {
    if (state?.kind !== 'preview' || state.busy || state.rows.length === 0) return
    const { rows, leftOut } = state
    setState({ ...state, busy: true })
    try {
      const created = await createTasksFromDrafts(rows.map((r) => r.draft), {
        description: `Created ${plural(rows.length, 'task', 'tasks')}`,
        snackbar: true,
      })
      setState({
        kind: 'prompt',
        leftOut,
        items: created.flatMap((c, i) => {
          const row = rows[i]
          return row ? [{ line: row.line, id: c.id, title: c.title }] : []
        }),
      })
    } catch {
      // Nothing was created: the drafts stay, no remove / keep prompt.
      onToast?.('Failed to create the tasks')
      setState({ ...state, busy: false })
    }
  }, [state, onToast])

  // The remove prompt acts only on lines whose task still exists (the
  // snackbar's Undo may have deleted them meanwhile).
  const finishPrompt = useCallback((remove: boolean) => {
    if (state?.kind !== 'prompt') return
    const existing = new Set(useTodoStore.getState().todos.map((t) => t.id))
    const items = state.items.filter((i) => existing.has(i.id))
    let missing = 0
    if (remove) {
      applyToNote((text) => {
        const found = locateLines(text, items.map((i) => i.line))
        missing = found.filter((n) => n == null).length
        return removeLineChanges(text, found.filter((n): n is number => n != null))
      })
    } else {
      missing = markConverted(items)
    }
    if (missing > 0) onToast?.(`${plural(missing, 'line was', 'lines were')} changed meanwhile and left as ${missing === 1 ? 'it is' : 'they are'}`)
    close()
  }, [state, applyToNote, markConverted, onToast, close])

  const entityCreators = useMemo(() => ({
    onCreatePerson: (name: string) => usePersonStore.getState().getOrCreate(name),
    onCreateTag: (name: string) => useTagStore.getState().add(name),
  }), [])

  const noop = useCallback(() => {}, [])

  let content: ReactNode = null
  if (state?.kind === 'single') {
    const { line, draft } = state
    content = (
      <TaskEditPopup
        mode="create"
        nested
        seed={draft}
        assignedPeople={[]}
        allPeople={people}
        assignedTags={[]}
        allTags={tags}
        onClose={close}
        onCreate={(partial, assignments) => createSingle(line, partial, assignments)}
        onAssignPerson={noop}
        onUnassignPerson={noop}
        onAssignTag={noop}
        onUnassignTag={noop}
        {...entityCreators}
      />
    )
  } else if (state?.kind === 'preview') {
    const editingRow = state.editing != null ? state.rows.find((r) => r.key === state.editing) : undefined
    const today = startOfToday()
    content = (
      <>
        <NotesConvertPreview
          rows={state.rows}
          lookups={{ people, tags, statuses, today, defaultFollowup: autoNextFollowup(today, { autoFollowup, followupDefaultInterval: followupInterval }) }}
          noteName={state.noteName}
          fromSelection={state.fromSelection}
          leftOut={state.leftOut}
          busy={state.busy}
          focusKey={state.focusKey}
          editing={editingRow !== undefined}
          onEdit={(key) => setState({ ...state, editing: key, focusKey: key })}
          onRemove={(key) => {
            const index = state.rows.findIndex((r) => r.key === key)
            const rows = state.rows.filter((r) => r.key !== key)
            const next = rows[Math.min(index, rows.length - 1)]
            setState({ ...state, rows, leftOut: state.leftOut + 1, focusKey: next?.key ?? null })
          }}
          onCreate={() => { void createAll() }}
          onCancel={close}
        />
        {editingRow && (
          <TaskEditPopup
            key={editingRow.key}
            mode="create"
            nested
            seed={editingRow.draft}
            assignedPeople={[]}
            allPeople={people}
            assignedTags={[]}
            allTags={tags}
            onClose={() => setState((s) => (s?.kind === 'preview' ? { ...s, editing: null } : s))}
            onCreate={async () => 0}
            onSaveDraft={(partial, assignments) => {
              const draft = draftFromEditor(partial, assignments, editorCtx())
              setState((s) => (s?.kind === 'preview'
                ? { ...s, rows: s.rows.map((r) => (r.key === editingRow.key ? { ...r, draft, edited: true } : r)) }
                : s))
            }}
            onAssignPerson={noop}
            onUnassignPerson={noop}
            onAssignTag={noop}
            onUnassignTag={noop}
            {...entityCreators}
          />
        )}
      </>
    )
  } else if (state?.kind === 'prompt') {
    const n = state.items.length
    content = (
      <ConfirmDialog
        open
        title={`Remove ${plural(n, 'converted line', 'converted lines')} from the note?`}
        message={`Keep marks ${n === 1 ? 'it' : 'them'} ✓ so ${n === 1 ? "it isn't" : "they aren't"} converted again.${
          state.leftOut > 0 ? ` The ${state.leftOut === 1 ? 'line you left out stays as it is' : 'lines you left out stay as they are'}.` : ''}`}
        confirmLabel={`Remove ${plural(n, 'line', 'lines')}`}
        cancelLabel="Keep"
        onConfirm={() => finishPrompt(true)}
        onCancel={() => finishPrompt(false)}
      />
    )
  }

  const layer = content
    ? createPortal(<div {...{ [NOTES_CONVERT_ATTR]: '' }}>{content}</div>, document.body)
    : null

  return { convertLine, convertScope, layer, open: state !== null }
}
