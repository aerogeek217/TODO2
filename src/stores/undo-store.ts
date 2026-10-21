import { create } from 'zustand'
import { NOTICE_SNACKBAR_MS, UNDO_SNACKBAR_MS } from '../constants'

export interface UndoEntry {
  description: string
  /** A second line for the snackbar when the entry is pushed with it (e.g. how to finish what was done); not part of the entry's name. */
  detail?: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

const MAX_STACK_SIZE = 50

/**
 * Thrown by an undo / redo that can't run yet for a reason the user can fix
 * (e.g. a layout that must be open first): the entry stays on its stack, and
 * the snackbar shows the error's message instead of "Couldn't undo: …".
 */
export class UndoRefused extends Error {}

/** What the snackbar says when an undo / redo throws `e`. */
function failureMessage(e: unknown, fallback: string): string {
  return e instanceof UndoRefused ? e.message : fallback
}

/** One entry made of `grouped`: undo runs theirs newest first, redo oldest first. */
function compoundOf(description: string, grouped: readonly UndoEntry[]): UndoEntry {
  return {
    description,
    async undo() {
      for (let i = grouped.length - 1; i >= 0; i--) {
        const item = grouped[i]
        if (item) await item.undo()
      }
    },
    async redo() {
      for (const entry of grouped) await entry.redo()
    },
  }
}

/** `stack` with `entry` at `index` (or last, when the stack got shorter). */
function insertAt(stack: UndoEntry[], index: number, entry: UndoEntry): UndoEntry[] {
  const at = Math.min(index, stack.length)
  return [...stack.slice(0, at), entry, ...stack.slice(at)]
}

interface UndoState {
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  isPerformingUndoRedo: boolean
  groupStartIndex: number | null
  /** What the snackbar shows. `notice`: a message with no Undo (`notify`); `detail`: a second line. */
  snackbar: { description: string; notice?: true; detail?: string } | null
  snackbarTimerId: ReturnType<typeof setTimeout> | null

  push: (entry: UndoEntry, showSnackbar?: boolean) => void
  /**
   * Undoes the newest entry and moves it to the redo stack. Never rejects:
   * an entry whose undo throws stays where it was (the next undo tries it
   * again) and the snackbar says it couldn't be undone.
   */
  undo: () => Promise<void>
  /** Redoes the newest undone entry; a failure is handled as in `undo`. */
  redo: () => Promise<void>
  /**
   * Mark the start of a compound operation. All entries pushed until
   * endGroup() are merged into one; while the group is open, pushes show no
   * snackbar.
   */
  beginGroup: () => void
  /** Merge all entries pushed since beginGroup() into a single undo entry. */
  endGroup: (description: string, showSnackbar?: boolean) => void
  /**
   * Ends the open group by taking back what it holds, newest first — a
   * compound operation that failed part-way leaves nothing behind and no
   * entry. Resolves `false` when an entry can't be taken back: the entries
   * not taken back then stay, as one entry named `description`, for the
   * user to undo. Shows no snackbar (the caller says what happened).
   */
  abortGroup: (description: string) => Promise<boolean>
  /**
   * Shows `description` in the snackbar without an Undo button — the result
   * of an operation that can't be undone (e.g. one run without a backup).
   * Leaves the undo stack alone.
   */
  notify: (description: string) => void
  dismissSnackbar: () => void
  clear: () => void
}

export const useUndoStore = create<UndoState>((set, get) => {
  /**
   * Hides the snackbar after `ms` — only the one shown with this timer: a
   * timer that is no longer the current one (replaced, or the store was put
   * back to its initial state) ends nothing.
   */
  const endSnackbarAfter = (ms: number): ReturnType<typeof setTimeout> => {
    const timerId = setTimeout(() => {
      if (get().snackbarTimerId === timerId) set({ snackbar: null, snackbarTimerId: null })
    }, ms)
    return timerId
  }

  return {
    undoStack: [],
    redoStack: [],
    isPerformingUndoRedo: false,
    groupStartIndex: null,
    snackbar: null,
    snackbarTimerId: null,

    push(entry: UndoEntry, showSnackbar = false) {
      const { undoStack, snackbarTimerId, groupStartIndex } = get()
      // Inside a group the stack is not trimmed (that would shift the group's
      // start; `endGroup` trims) and no snackbar shows (`endGroup` decides).
      const inGroup = groupStartIndex != null
      const trimmed = !inGroup && undoStack.length >= MAX_STACK_SIZE
        ? undoStack.slice(undoStack.length - MAX_STACK_SIZE + 1)
        : undoStack

      if (snackbarTimerId != null) clearTimeout(snackbarTimerId)

      if (showSnackbar && !inGroup) {
        // A second line is more to read: it stays as long as a notice.
        const timerId = endSnackbarAfter(entry.detail ? NOTICE_SNACKBAR_MS : UNDO_SNACKBAR_MS)
        set({
          undoStack: [...trimmed, entry],
          redoStack: [],
          snackbar: entry.detail ? { description: entry.description, detail: entry.detail } : { description: entry.description },
          snackbarTimerId: timerId,
        })
      } else {
        set({
          undoStack: [...trimmed, entry],
          redoStack: [],
          snackbar: null,
          snackbarTimerId: null,
        })
      }
    },

    async undo() {
      const { undoStack, isPerformingUndoRedo } = get()
      if (undoStack.length === 0 || isPerformingUndoRedo) return

      const index = undoStack.length - 1
      const entry = undoStack[index]
      if (!entry) return
      set({
        undoStack: undoStack.slice(0, -1),
        isPerformingUndoRedo: true,
      })

      let failed: string | null = null
      try {
        await entry.undo()
      } catch (e) {
        failed = failureMessage(e, `Couldn't undo: ${entry.description}`)
        if (!(e instanceof UndoRefused)) console.error(`Undo failed: ${entry.description}`, e)
      }
      if (failed != null) {
        // It didn't happen: back where it was, to try again.
        set({ undoStack: insertAt(get().undoStack, index, entry), isPerformingUndoRedo: false })
        get().notify(failed)
      } else {
        set({ redoStack: [...get().redoStack, entry], isPerformingUndoRedo: false })
      }
    },

    async redo() {
      const { redoStack, isPerformingUndoRedo } = get()
      if (redoStack.length === 0 || isPerformingUndoRedo) return

      const index = redoStack.length - 1
      const entry = redoStack[index]
      if (!entry) return
      set({
        redoStack: redoStack.slice(0, -1),
        isPerformingUndoRedo: true,
      })

      let failed: string | null = null
      try {
        await entry.redo()
      } catch (e) {
        failed = failureMessage(e, `Couldn't redo: ${entry.description}`)
        if (!(e instanceof UndoRefused)) console.error(`Redo failed: ${entry.description}`, e)
      }
      if (failed != null) {
        set({ redoStack: insertAt(get().redoStack, index, entry), isPerformingUndoRedo: false })
        get().notify(failed)
      } else {
        set({ undoStack: [...get().undoStack, entry], isPerformingUndoRedo: false })
      }
    },

    beginGroup() {
      set({ groupStartIndex: get().undoStack.length })
    },

    endGroup(description: string, showSnackbar = false) {
      const { undoStack, groupStartIndex, snackbarTimerId } = get()
      if (groupStartIndex == null) return

      const grouped = undoStack.slice(groupStartIndex)
      if (grouped.length === 0) {
        set({ groupStartIndex: null })
        return
      }

      const compound = compoundOf(description, grouped)

      const base = undoStack.slice(0, groupStartIndex)
      const trimmed = base.length >= MAX_STACK_SIZE
        ? base.slice(base.length - MAX_STACK_SIZE + 1)
        : base

      if (snackbarTimerId != null) clearTimeout(snackbarTimerId)

      if (showSnackbar) {
        const timerId = endSnackbarAfter(UNDO_SNACKBAR_MS)
        set({
          undoStack: [...trimmed, compound],
          redoStack: [],
          groupStartIndex: null,
          snackbar: { description },
          snackbarTimerId: timerId,
        })
      } else {
        set({
          undoStack: [...trimmed, compound],
          redoStack: [],
          groupStartIndex: null,
          snackbar: null,
          snackbarTimerId: null,
        })
      }
    },

    async abortGroup(description: string) {
      const { undoStack, groupStartIndex } = get()
      if (groupStartIndex == null) return true
      const grouped = undoStack.slice(groupStartIndex)
      // Like an undo: the stores' writes made while taking back push nothing.
      set({ undoStack: undoStack.slice(0, groupStartIndex), groupStartIndex: null, isPerformingUndoRedo: true })
      try {
        for (let i = grouped.length - 1; i >= 0; i--) {
          const entry = grouped[i]
          if (!entry) continue
          try {
            await entry.undo()
          } catch (e) {
            console.error(`Couldn't take back: ${entry.description}`, e)
            set({ undoStack: [...get().undoStack, compoundOf(description, grouped.slice(0, i + 1))], redoStack: [] })
            return false
          }
        }
        return true
      } finally {
        set({ isPerformingUndoRedo: false })
      }
    },

    notify(description: string) {
      const { snackbarTimerId } = get()
      if (snackbarTimerId != null) clearTimeout(snackbarTimerId)
      const timerId = endSnackbarAfter(NOTICE_SNACKBAR_MS)
      set({ snackbar: { description, notice: true }, snackbarTimerId: timerId })
    },

    dismissSnackbar() {
      const { snackbarTimerId } = get()
      if (snackbarTimerId != null) clearTimeout(snackbarTimerId)
      set({ snackbar: null, snackbarTimerId: null })
    },

    clear() {
      const { snackbarTimerId } = get()
      if (snackbarTimerId != null) clearTimeout(snackbarTimerId)
      set({ undoStack: [], redoStack: [], groupStartIndex: null, snackbar: null, snackbarTimerId: null })
    },
  }
})
