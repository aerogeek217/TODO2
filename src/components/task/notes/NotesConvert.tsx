import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from '@codemirror/view'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { autoNextFollowup, useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { getFilterDefaults } from '../../../utils/filter-defaults'
import { startOfToday } from '../../../utils/date'
import { shortTitle } from '../../../utils/text'
import {
  applyTextChanges,
  convertCandidates,
  locateLines,
  markLineChanges,
  removeLineChanges,
  selectionLines,
  singleLineCandidateAt,
  type ConvertLine,
  type TextChange,
} from '../../../services/note-lines'
import { draftFromEditor, draftFromResolved, draftFromText, type DraftContext, type EditorTaskFields, type TaskDraft } from '../../../services/task-draft'
import { createTasksFromDrafts } from '../../../services/note-tasks'
import { createTaskFromDraft } from '../../../services/create-task'
import { noteSubtaskDrafts, type NoteSubtaskTarget } from '../../../services/note-subtasks'
import { QuickAddBar, type QuickAddDraft } from '../QuickAddBar'
import { ConfirmDialog } from '../../shared/Dialog'
import { TaskEditPopup } from '../TaskEditPopup'
import { convertActionLabel, plural } from './convert-action-label'
import { NotesConvertPreview, type PreviewRow } from './NotesConvertPreview'

interface CreatedLine {
  line: ConvertLine
  id: number
  title: string
}

type ConvertState =
  | { kind: 'quick'; line: ConvertLine }
  | { kind: 'single'; line: ConvertLine; draft: TaskDraft; typed?: boolean }
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
  | { kind: 'prompt'; items: CreatedLine[]; leftOut: number; cleared: ConvertLine[] }

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
  return shortTitle(name)
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

/** `draft` with the line's subtask lines as plain subtasks (cr28). */
function withLineSubtasks(draft: TaskDraft, line: ConvertLine): TaskDraft {
  const subtasks = line.subtasks ?? []
  return subtasks.length > 0 ? { ...draft, subtasks: subtasks.map((s) => ({ title: s.title, isCompleted: s.done })) } : draft
}

/** The line's draft: its body parsed, with its subtask lines. */
function draftOf(line: ConvertLine, ctx: DraftContext): TaskDraft {
  return withLineSubtasks(draftFromText(line.body, ctx), line)
}

/**
 * Finds `lines` (and their subtask lines) in `text` as it is now: the lines
 * found, by kind, and how many of the lines themselves couldn't be found.
 */
function locateConvertLines(text: string, lines: readonly ConvertLine[]): { parents: (number | null)[]; children: number[]; missing: number } {
  const parents = locateLines(text, lines)
  const childTargets = lines.flatMap((l) => l.subtasks ?? [])
  const children = locateLines(text, childTargets).filter((n): n is number => n != null)
  return { parents, children, missing: parents.filter((n) => n == null).length }
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
  /** A task's notes: lines become that task's subtasks, at once, instead of tasks. */
  subtaskTarget?: NoteSubtaskTarget
}

/**
 * Notes → tasks. `convertLine` (Alt+T) and `convertLineAt` (the editor's
 * hover icon) open Quick Add on one line, its text prefilled (Details hands
 * off to the task editor); `convertScope` (the toolbar's Convert) takes the
 * bullet lines of the note, or of the selection: two or more open the
 * preview, exactly one opens Quick Add like Alt+T. Created tasks turn
 * their lines into `✓ <title>`; after a preview the user picks Remove (the
 * lines go) or Keep (`✓`) — one editor transaction, so one Ctrl+Z in the
 * note undoes it. With Settings' `removeConvertedLines` the lines just go,
 * from a single line too, and nothing is asked. A draft checked off in the preview makes no task: its line
 * goes in that same transaction, whichever is picked (with only checked
 * drafts there is nothing to pick). A line's indented list lines become its task's subtasks
 * (cr28): they go with the line on Remove, and on Keep too (their text now
 * lives in the task). The task create is its own undo step (the snackbar's
 * Undo deletes the tasks and leaves the note as it is).
 *
 * With a `subtaskTarget` (a task's notes) every one of those converts its lines
 * to that task's subtasks at once: a subtask is a title and a done state, so
 * there is nothing to fill in or preview. The lines turn `✓` (or go, with the
 * setting) in the same undo step as the subtasks.
 */
export function useNotesConvert({ viewRef, getText, setText, flush, onToast, subtaskTarget }: NotesConvertOptions) {
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

  /**
   * Rewrites converted lines as `✓ <title>` and removes their subtask lines,
   * and removes `cleared` lines (checked off) with theirs; returns how many
   * lines couldn't be found.
   */
  const markConverted = useCallback((items: readonly { line: ConvertLine; title: string }[], cleared: readonly ConvertLine[] = []) => {
    let missing = 0
    applyToNote((text) => {
      // Located together, so two identical lines can't claim the same one.
      const found = locateConvertLines(text, [...items.map((i) => i.line), ...cleared])
      missing = found.missing
      return [
        ...markLineChanges(text, items.flatMap((item, k) => {
          const line = found.parents[k]
          return line != null ? [{ line, title: item.title }] : []
        })),
        ...removeLineChanges(text, [
          ...found.children,
          ...found.parents.slice(items.length).filter((n): n is number => n != null),
        ]),
      ]
    })
    return missing
  }, [applyToNote])

  /** Removes `lines` with their subtask lines; returns how many couldn't be found. */
  const removeLines = useCallback((lines: readonly ConvertLine[]) => {
    let missing = 0
    applyToNote((text) => {
      const found = locateConvertLines(text, lines)
      missing = found.missing
      return removeLineChanges(text, [...found.parents.filter((n): n is number => n != null), ...found.children])
    })
    return missing
  }, [applyToNote])

  const close = useCallback(() => {
    setState(null)
    viewRef.current?.focus()
  }, [viewRef])

  const convertingRef = useRef(false)
  const convertToSubtasks = useCallback(async (target: NoteSubtaskTarget, lines: readonly ConvertLine[]) => {
    if (convertingRef.current) return
    convertingRef.current = true
    try {
      // What was typed is its own edit, before the group opens.
      await flush?.()
      let missing = 0
      await target(noteSubtaskDrafts(lines), async () => {
        missing = useSettingsStore.getState().removeConvertedLines
          ? removeLines(lines)
          : markConverted(lines.map((line) => ({ line, title: line.body })))
        await flush?.()
      })
      if (missing > 0) onToast?.(`${plural(missing, 'line was', 'lines were')} changed meanwhile and left as ${missing === 1 ? 'it is' : 'they are'}`)
    } finally {
      convertingRef.current = false
    }
  }, [flush, removeLines, markConverted, onToast])

  const openSingle = useCallback((line: ConvertLine) => {
    if (subtaskTarget) {
      void convertToSubtasks(subtaskTarget, [line])
      return
    }
    void flush?.()
    setState({ kind: 'quick', line })
  }, [flush, subtaskTarget, convertToSubtasks])

  /** Alt+T: the caret line. False when it can't be converted (blank / already `✓`). */
  const convertLine = useCallback((view: EditorView): boolean => {
    if (state) return true
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const candidate = singleLineCandidateAt(view.state.doc.toString(), line.number)
    if (!candidate) return false
    openSingle(candidate)
    return true
  }, [state, openSingle])

  /** The editor's hover icon: line `n`, as Alt+T takes the caret's. */
  const convertLineAt = useCallback((n: number) => {
    if (state) return
    const candidate = singleLineCandidateAt(currentText(), n)
    if (candidate) openSingle(candidate)
  }, [state, currentText, openSingle])

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
    if (subtaskTarget) {
      void convertToSubtasks(subtaskTarget, lines)
      return
    }
    void flush?.()
    const ctx = draftContext()
    setState({
      kind: 'preview',
      rows: lines.map((line, key) => ({ key, line, draft: draftOf(line, ctx), edited: false })),
      fromSelection: range != null,
      noteName: noteNameOf(text),
      leftOut: 0,
      editing: null,
      focusKey: null,
      busy: false,
    })
  }, [state, viewRef, currentText, openSingle, flush, subtaskTarget, convertToSubtasks])

  const editorCtx = useCallback(() => ({
    people: usePersonStore.getState().people,
    statuses: useStatusStore.getState().statuses,
    tags: useTagStore.getState().tags,
    today: new Date(),
  }), [])

  // Single line: create, then mark the line `✓ <title>` (no prompt). Not
  // stored (the snackbar says so): null keeps Quick Add or the editor open and
  // the line as it is.
  const createLineTask = useCallback(async (line: ConvertLine, draft: TaskDraft) => {
    const id = await createTaskFromDraft(draft)
    if (id == null) return null
    useUIStore.getState().showRecentlyCreated(id)
    const missing = useSettingsStore.getState().removeConvertedLines
      ? removeLines([line])
      : markConverted([{ line, title: draft.title }])
    if (missing > 0) onToast?.('Task created — its line changed, so it was left as it is')
    return id
  }, [markConverted, removeLines, onToast])

  const createSingle = useCallback((line: ConvertLine, partial: EditorTaskFields, assignments?: { personIds: number[]; tagIds: number[] }) => (
    createLineTask(line, draftFromEditor(partial, assignments ?? { personIds: [], tagIds: [] }, editorCtx()))
  ), [createLineTask, editorCtx])

  // Quick Add's text, with the defaults every note line gets (`draftContext`).
  const createFromQuickAdd = useCallback(async (line: ConvertLine, submitted: QuickAddDraft) => {
    const draft = withLineSubtasks(draftFromResolved(submitted.resolved, submitted.title, draftContext()), line)
    return (await createLineTask(line, draft)) != null
  }, [createLineTask])

  const createAll = useCallback(async () => {
    if (state?.kind !== 'preview' || state.busy || state.rows.length === 0) return
    const { leftOut } = state
    const rows = state.rows.filter((r) => r.checked !== true)
    const cleared = state.rows.filter((r) => r.checked === true).map((r) => r.line)
    if (rows.length === 0) {
      // Only checked drafts: no task, nothing to pick. The note's Ctrl+Z brings them back.
      const missing = removeLines(cleared)
      onToast?.(missing > 0
        ? `${plural(missing, 'line was', 'lines were')} changed meanwhile and left as ${missing === 1 ? 'it is' : 'they are'}`
        : `Removed ${plural(cleared.length, 'line', 'lines')} · Ctrl+Z in the note brings ${cleared.length === 1 ? 'it' : 'them'} back`)
      close()
      return
    }
    setState({ ...state, busy: true })
    try {
      const created = await createTasksFromDrafts(rows.map((r) => r.draft), {
        description: `Created ${plural(rows.length, 'task', 'tasks')}`,
        snackbar: true,
      })
      if (useSettingsStore.getState().removeConvertedLines) {
        // Nothing to ask: their lines go, with the checked ones, in one note edit.
        const missing = removeLines([...rows.map((r) => r.line), ...cleared])
        if (missing > 0) onToast?.(`${plural(missing, 'line was', 'lines were')} changed meanwhile and left as ${missing === 1 ? 'it is' : 'they are'}`)
        close()
        return
      }
      setState({
        kind: 'prompt',
        leftOut,
        cleared,
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
  }, [state, onToast, removeLines, close])

  // Esc, the backdrop or × over changes the note doesn't hold asks first; Cancel doesn't.
  const askingToCloseRef = useRef(false)
  const dismissPreview = useCallback(() => {
    if (state?.kind !== 'preview') return
    if (!state.rows.some((r) => r.edited || r.checked === true) && state.leftOut === 0) {
      close()
      return
    }
    if (askingToCloseRef.current) return
    askingToCloseRef.current = true
    void useUIStore.getState().askChoice({
      title: 'Keep your changes to these drafts?',
      message: 'Nothing has been created or removed yet.',
      confirmLabel: state.rows.length > 0 ? convertActionLabel(state.rows) : 'Keep editing',
      discardLabel: 'Discard',
      cancelLabel: 'Keep editing',
    }).then((picked) => {
      askingToCloseRef.current = false
      if (picked === 'discard') close()
      else if (picked === 'confirm' && state.rows.length > 0) void createAll()
    })
  }, [state, close, createAll])

  // The remove prompt acts only on lines whose task still exists (the
  // snackbar's Undo may have deleted them meanwhile).
  const finishPrompt = useCallback((remove: boolean) => {
    if (state?.kind !== 'prompt') return
    const existing = new Set(useTodoStore.getState().todos.map((t) => t.id))
    const items = state.items.filter((i) => existing.has(i.id))
    const missing = remove
      ? removeLines([...items.map((i) => i.line), ...state.cleared])
      : markConverted(items, state.cleared)
    if (missing > 0) onToast?.(`${plural(missing, 'line was', 'lines were')} changed meanwhile and left as ${missing === 1 ? 'it is' : 'they are'}`)
    close()
  }, [state, removeLines, markConverted, onToast, close])

  const entityCreators = useMemo(() => ({
    onCreatePerson: (name: string) => usePersonStore.getState().getOrCreate(name),
    onCreateTag: (name: string) => useTagStore.getState().add(name),
  }), [])

  const noop = useCallback(() => {}, [])

  let content: ReactNode = null
  if (state?.kind === 'quick') {
    const { line } = state
    const subtaskCount = line.subtasks?.length ?? 0
    content = (
      <QuickAddBar
        open
        initialDraft={{ rawTitle: line.body }}
        // They aren't shown here, and their lines go from the note with this one.
        preset={subtaskCount > 0 ? { caption: `With ${plural(subtaskCount, 'subtask', 'subtasks')}` } : undefined}
        onClose={close}
        onSubmit={(submitted) => createFromQuickAdd(line, submitted)}
        onOpenFullEditor={(submitted) => {
          // Edited in the bar: the editor asks before that is dropped.
          setState({ kind: 'single', line, draft: withLineSubtasks(draftFromText(submitted.rawTitle, draftContext()), line), typed: submitted.rawTitle !== line.body })
        }}
      />
    )
  } else if (state?.kind === 'single') {
    const { line, draft, typed } = state
    content = (
      <TaskEditPopup
        mode="create"
        nested
        seed={draft}
        seedTyped={typed}
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
          onChange={(key, draft) => setState((s) => (s?.kind === 'preview'
            ? { ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, draft, edited: true } : r)) }
            : s))}
          onCheck={(key, checked) => setState((s) => (s?.kind === 'preview'
            ? { ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, checked } : r)) }
            : s))}
          onRemove={(key) => {
            const index = state.rows.findIndex((r) => r.key === key)
            const rows = state.rows.filter((r) => r.key !== key)
            const next = rows[Math.min(index, rows.length - 1)]
            setState({ ...state, rows, leftOut: state.leftOut + 1, focusKey: next?.key ?? null })
          }}
          onCreate={() => { void createAll() }}
          onCancel={close}
          onDismiss={dismissPreview}
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
          state.cleared.length > 0 ? ` ${plural(state.cleared.length, 'line', 'lines')} you checked off ${state.cleared.length === 1 ? 'goes' : 'go'} either way.` : ''
        }${
          state.leftOut > 0 ? ` The ${state.leftOut === 1 ? 'line you left out stays as it is' : 'lines you left out stay as they are'}.` : ''}`}
        confirmLabel={`Remove ${plural(n, 'line', 'lines')}`}
        cancelLabel="Keep"
        onConfirm={() => finishPrompt(true)}
        onCancel={() => finishPrompt(false)}
      />
    )
  }

  const layer = content ? createPortal(content, document.body) : null

  return { convertLine, convertLineAt, convertScope, layer, open: state !== null }
}
