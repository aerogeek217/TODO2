import { create } from 'zustand'
import { UNDO_SNACKBAR_MS } from '../constants'

export interface UndoEntry {
  description: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

const MAX_STACK_SIZE = 50

interface UndoState {
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  isPerformingUndoRedo: boolean
  groupStartIndex: number | null
  snackbar: { description: string } | null
  snackbarTimerId: ReturnType<typeof setTimeout> | null

  push: (entry: UndoEntry, showSnackbar?: boolean) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  /** Mark the start of a compound operation. All entries pushed until endGroup() are merged into one. */
  beginGroup: () => void
  /** Merge all entries pushed since beginGroup() into a single undo entry. */
  endGroup: (description: string, showSnackbar?: boolean) => void
  dismissSnackbar: () => void
  clear: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

export const useUndoStore = create<UndoState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  isPerformingUndoRedo: false,
  groupStartIndex: null,
  snackbar: null,
  snackbarTimerId: null,

  push(entry: UndoEntry, showSnackbar = false) {
    const { undoStack, snackbarTimerId } = get()
    const trimmed = undoStack.length >= MAX_STACK_SIZE
      ? undoStack.slice(undoStack.length - MAX_STACK_SIZE + 1)
      : undoStack

    if (snackbarTimerId != null) clearTimeout(snackbarTimerId)

    if (showSnackbar) {
      const timerId = setTimeout(() => {
        set({ snackbar: null, snackbarTimerId: null })
      }, UNDO_SNACKBAR_MS)
      set({
        undoStack: [...trimmed, entry],
        redoStack: [],
        snackbar: { description: entry.description },
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

    const entry = undoStack[undoStack.length - 1]
    set({
      undoStack: undoStack.slice(0, -1),
      isPerformingUndoRedo: true,
    })

    try {
      await entry.undo()
    } finally {
      const { redoStack } = get()
      set({
        redoStack: [...redoStack, entry],
        isPerformingUndoRedo: false,
      })
    }
  },

  async redo() {
    const { redoStack, isPerformingUndoRedo } = get()
    if (redoStack.length === 0 || isPerformingUndoRedo) return

    const entry = redoStack[redoStack.length - 1]
    set({
      redoStack: redoStack.slice(0, -1),
      isPerformingUndoRedo: true,
    })

    try {
      await entry.redo()
    } finally {
      const { undoStack } = get()
      set({
        undoStack: [...undoStack, entry],
        isPerformingUndoRedo: false,
      })
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

    const compound: UndoEntry = {
      description,
      async undo() {
        for (let i = grouped.length - 1; i >= 0; i--) await grouped[i].undo()
      },
      async redo() {
        for (const entry of grouped) await entry.redo()
      },
    }

    const base = undoStack.slice(0, groupStartIndex)
    const trimmed = base.length >= MAX_STACK_SIZE
      ? base.slice(base.length - MAX_STACK_SIZE + 1)
      : base

    if (snackbarTimerId != null) clearTimeout(snackbarTimerId)

    if (showSnackbar) {
      const timerId = setTimeout(() => {
        set({ snackbar: null, snackbarTimerId: null })
      }, UNDO_SNACKBAR_MS)
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

  canUndo() {
    return get().undoStack.length > 0
  },

  canRedo() {
    return get().redoStack.length > 0
  },
}))
