import { useCallback, useRef, useState, type RefObject } from 'react'
import type { StatusUpdateDraft, SubtaskDraft } from '../../models'
import type { PersistedStatusUpdate } from '../../models/status-update'
import type { PersistedSubtask } from '../../models/subtask'
import { addStatusUpdate } from '../../services/mark-followed-up'
import { addSubtasksFromNote, type NoteSubtaskTarget } from '../../services/note-subtasks'
import { useStatusUpdateStore, useStatusUpdates } from '../../stores/status-update-store'
import { useSubtasks, useSubtaskStore } from '../../stores/subtask-store'
import { compareStatusUpdates, statusUpdateDay } from '../../utils/status-updates'
import { subtaskTitle } from '../../utils/subtasks'
import type { StatusUpdateEntry, StatusUpdateFields } from './status-updates/StatusUpdatesSection'
import type { ChecklistItem } from './subtasks/SubtaskChecklist'

/**
 * The task editor's two sections over a task's own rows (cr31 A7 moved them
 * out of `TaskEditPopup`): in edit mode (`todoId`) each change is written at
 * once through its store — its own undo step, after the notes typed so far
 * (`flushNotes`) —; in create mode the rows are kept here (a local key each)
 * until Create writes them with the task.
 */
interface EditorEntriesOptions {
  /** Edit mode (else create mode). */
  isEdit: boolean
  /** The task being edited. */
  todoId: number | undefined
  /** Writes the notes typed so far (each edit stays its own undo step, in order). */
  flushNotes: () => Promise<unknown>
}

/** A pending status update: its day, text and when it was written. */
export type PendingStatusUpdate = StatusUpdateEntry & { createdAt: Date }

export interface EditorStatusUpdates {
  /** What the section shows: the stored entries, or the pending ones (newest first). */
  entries: readonly (PersistedStatusUpdate | PendingStatusUpdate)[]
  /** The pending entries as rendered (create mode). */
  pending: readonly PendingStatusUpdate[]
  add: (entry: StatusUpdateFields) => void
  edit: (id: number, changes: StatusUpdateFields) => void
  remove: (id: number) => void
  /** The section's commit of an entry still being edited (create mode; edit mode: none). */
  commitRef: RefObject<(() => void) | null> | undefined
  /** The pending entries with an open edit or add written first (for Create and the close check). */
  committed: () => readonly PendingStatusUpdate[]
}

/** The editor's Status updates section over the store or its pending entries. */
export function useEditorStatusUpdates(
  { isEdit, todoId, flushNotes }: EditorEntriesOptions,
  seed: readonly StatusUpdateDraft[] | undefined,
): EditorStatusUpdates {
  const stored = useStatusUpdates(todoId)
  const [pending, setPending] = useState<PendingStatusUpdate[]>(
    () => (seed ?? []).map((u, i) => ({ ...u, id: i + 1 })).sort(compareStatusUpdates),
  )
  // The pending entries as written so far, for Create and the close check —
  // which first commit an entry still being edited (`commitRef`), in the
  // same handler, before a re-render could show it.
  const pendingRef = useRef(pending)
  const update = (next: (prev: PendingStatusUpdate[]) => PendingStatusUpdate[]) => {
    pendingRef.current = next(pendingRef.current)
    setPending(pendingRef.current)
  }
  const commitRef = useRef<(() => void) | null>(null)
  return {
    entries: isEdit ? stored : pending,
    pending,
    add(entry) {
      if (isEdit && todoId !== undefined) {
        // After the notes (once the follow-up's undo group is open, a write landing would join it).
        void flushNotes().finally(() => addStatusUpdate(todoId, entry))
        return
      }
      const now = new Date()
      update((prev) => [
        ...prev,
        { id: Math.max(0, ...prev.map((u) => u.id)) + 1, date: statusUpdateDay(entry.date, now), text: entry.text, createdAt: now },
      ].sort(compareStatusUpdates))
    },
    edit(id, changes) {
      if (isEdit) {
        void flushNotes()
        void useStatusUpdateStore.getState().update(id, changes)
        return
      }
      const date = statusUpdateDay(changes.date, new Date())
      update((prev) => prev.map((u) => (u.id === id ? { ...u, date, text: changes.text } : u)).sort(compareStatusUpdates))
    },
    remove(id) {
      if (isEdit) {
        void flushNotes()
        void useStatusUpdateStore.getState().remove(id)
        return
      }
      update((prev) => prev.filter((u) => u.id !== id))
    },
    commitRef: isEdit ? undefined : commitRef,
    committed() {
      commitRef.current?.()
      return pendingRef.current
    },
  }
}

export interface EditorSubtasks {
  /** What the section shows: the stored checklist, or the pending one (in order). */
  items: readonly (PersistedSubtask | ChecklistItem)[]
  /** The pending subtasks (create mode). */
  pending: readonly ChecklistItem[]
  add: (title: string) => void
  rename: (id: number, title: string) => void
  setDone: (id: number, done: boolean) => void
  remove: (id: number) => void
  move: (id: number, toIndex: number) => void
  /** Notes → this task's subtasks: stored at once, or pending with the rest. Stable for the notes editor's keymap (cr31 N6). */
  noteTarget: NoteSubtaskTarget
}

/** The editor's Subtasks section over the store or its pending checklist. */
export function useEditorSubtasks(
  { isEdit, todoId, flushNotes }: EditorEntriesOptions,
  seed: readonly SubtaskDraft[] | undefined,
): EditorSubtasks {
  const stored = useSubtasks(todoId)
  const [pending, setPending] = useState<ChecklistItem[]>(
    () => (seed ?? []).map((s, i) => ({ id: i + 1, title: s.title, isCompleted: s.isCompleted })),
  )
  /** An edit-mode write: after the notes typed so far. */
  const write = (run: () => void) => {
    void flushNotes()
    run()
  }
  const noteTarget = useCallback<NoteSubtaskTarget>(async (drafts, writeNote) => {
    if (isEdit && todoId !== undefined) return addSubtasksFromNote(todoId, drafts, writeNote)
    setPending((prev) => {
      const first = Math.max(0, ...prev.map((s) => s.id)) + 1
      return [...prev, ...drafts.map((d, i) => ({ id: first + i, title: subtaskTitle(d.title), isCompleted: d.done }))]
    })
    await writeNote()
    return true
  }, [isEdit, todoId])
  return {
    items: isEdit ? stored : pending,
    pending,
    add(title) {
      if (isEdit && todoId !== undefined) return write(() => { void useSubtaskStore.getState().add(todoId, title) })
      setPending((prev) => [...prev, { id: Math.max(0, ...prev.map((s) => s.id)) + 1, title, isCompleted: false }])
    },
    rename(id, title) {
      if (isEdit) return write(() => { void useSubtaskStore.getState().rename(id, title) })
      setPending((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
    },
    setDone(id, done) {
      if (isEdit) return write(() => { void useSubtaskStore.getState().setDone(id, done) })
      setPending((prev) => prev.map((s) => (s.id === id ? { ...s, isCompleted: done } : s)))
    },
    remove(id) {
      if (isEdit) return write(() => { void useSubtaskStore.getState().remove(id) })
      setPending((prev) => prev.filter((s) => s.id !== id))
    },
    move(id, toIndex) {
      if (isEdit) return write(() => { void useSubtaskStore.getState().move(id, toIndex) })
      setPending((prev) => {
        const from = prev.findIndex((s) => s.id === id)
        if (from === -1) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        if (moved) next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved)
        return next
      })
    },
    noteTarget,
  }
}
