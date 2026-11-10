import { create } from 'zustand'
import { NOTICE_SNACKBAR_MS, UNDO_SNACKBAR_MS } from '../constants'
import { registerModuleReset } from '../utils/module-reset'

/** A snackbar button that does something other than undo. */
export interface UndoSnackbarAction {
  label: string
  run: () => void
}

export interface UndoEntry {
  description: string
  /** A second line for the snackbar when the entry is pushed with it (e.g. how to finish what was done); not part of the entry's name. */
  detail?: string
  /**
   * An offer the snackbar makes beside Undo when the entry is pushed with
   * it (e.g. Complete task, after a checklist's last check): its own step
   * when taken, never run on its own.
   */
  action?: UndoSnackbarAction
  /**
   * Merges a run of pushes into one step: a push whose key matches the
   * newest entry's (with no group open) replaces that entry's redo instead of
   * adding an entry, so its undo still goes back to before
   * the first of them (a name typed letter by letter, a divider stepped by
   * the arrow keys). See `push`.
   */
  mergeKey?: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

const MAX_STACK_SIZE = 50

/**
 * The handle of one open undo group (`beginGroup`): only its holder ends or
 * aborts it. Opaque — compared by identity.
 */
export interface UndoGroupToken { readonly __undoGroup: true }

/** The groups run through `runGroup`, in order: one at a time (the store has one open group). */
let groupQueue: Promise<unknown> = Promise.resolve()
registerModuleReset(() => { groupQueue = Promise.resolve() })

/**
 * Resolves once no group run through `runGroup` is open or waiting — an
 * undo or redo pressed meanwhile then takes the whole compound step, never
 * a part of it (cr31 stores L5). A group opened with `beginGroup` alone
 * isn't waited for.
 */
async function groupsSettled(isOpen: () => boolean): Promise<void> {
  let queue = groupQueue
  while (isOpen()) {
    await queue
    if (queue === groupQueue) return
    queue = groupQueue
  }
}

/**
 * Thrown by an undo / redo that can't run yet for a reason the user can fix
 * (e.g. a layout that must be open first): the entry stays on its stack, and
 * the snackbar shows the error's message instead of "Couldn't undo: …".
 */
export class UndoRefused extends Error {}

/**
 * Thrown by an undo / redo whose subject is gone for good (its task was
 * deleted with no undo step — a purge of completed tasks): the entry is
 * dropped, never retried, and the snackbar shows the error's message — so
 * the next undo reaches the step before it instead of silently "undoing"
 * nothing (cr31 stores L6).
 */
export class UndoGone extends Error {}

/** What the snackbar says when an undo / redo throws `e`. */
function failureMessage(e: unknown, fallback: string): string {
  return e instanceof UndoRefused ? e.message : fallback
}

/**
 * Runs `step` over `entries` in order; a part whose subject is gone
 * (`UndoGone`) is skipped — only when every part is gone does the whole step
 * throw it.
 */
async function eachPart(entries: readonly UndoEntry[], step: (entry: UndoEntry) => void | Promise<void>): Promise<void> {
  let gone: UndoGone | null = null
  let ran = false
  for (const entry of entries) {
    try {
      await step(entry)
      ran = true
    } catch (e) {
      if (!(e instanceof UndoGone)) throw e
      gone = e
    }
  }
  if (gone && !ran) throw gone
}

/** One entry made of `grouped`: undo runs theirs newest first, redo oldest first. */
function compoundOf(description: string, grouped: readonly UndoEntry[]): UndoEntry {
  return {
    description,
    undo: () => eachPart([...grouped].reverse(), (entry) => entry.undo()),
    redo: () => eachPart(grouped, (entry) => entry.redo()),
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
  /** The open group's handle (`beginGroup`), or null. */
  groupToken: UndoGroupToken | null
  /** What the snackbar shows. `notice`: a message with no Undo (`notify`); `detail`: a second line; `action`: an offer beside Undo. */
  snackbar: { description: string; notice?: true; detail?: string; action?: UndoSnackbarAction } | null
  snackbarTimerId: ReturnType<typeof setTimeout> | null

  /**
   * Adds `entry` as the newest step (and clears the redo stack). With a
   * `mergeKey` that the newest entry has too, and no group open, it merges
   * instead: the newest entry keeps its undo and its name and takes
   * `entry`'s redo (`mergeTarget` says beforehand whether it would). Returns the entry
   * that is now the newest.
   */
  push: (entry: UndoEntry, showSnackbar?: boolean) => UndoEntry
  /** The newest entry, when a push with `mergeKey` would merge into it; else `null`. */
  mergeTarget: (mergeKey: string) => UndoEntry | null
  /** Drops `entry` when it is the newest entry (a merged run that came back to where it started: nothing left to undo). */
  dropNewest: (entry: UndoEntry) => void
  /**
   * Undoes the newest entry and moves it to the redo stack — after the
   * compound step in progress, if any, has ended (it is then the newest
   * entry). Never rejects: an entry whose undo throws stays where it was
   * (the next undo tries it again) and the snackbar says it couldn't be
   * undone.
   */
  undo: () => Promise<void>
  /** Redoes the newest undone entry (after a compound step in progress, as `undo`); a failure is handled as in `undo`. */
  redo: () => Promise<void>
  /**
   * Mark the start of a compound operation. All entries pushed until
   * `endGroup(token)` are merged into one; while the group is open, pushes
   * show no snackbar. Returns the group's handle. Callers use `runGroup`,
   * which waits for any group before it — a second `beginGroup` while one is
   * open warns and starts a new group (the first one's entries stay as they
   * were pushed, and its token ends nothing).
   */
  beginGroup: () => UndoGroupToken
  /**
   * Merge all entries pushed since `beginGroup()` into a single undo entry.
   * A token that isn't the open group's does nothing (and warns).
   */
  endGroup: (token: UndoGroupToken, description: string, showSnackbar?: boolean) => void
  /**
   * Ends the open group by taking back what it holds, newest first — a
   * compound operation that failed part-way leaves nothing behind and no
   * entry. Resolves `false` when an entry can't be taken back: the entries
   * not taken back then stay, as one entry named `description`, for the
   * user to undo. Shows no snackbar (the caller says what happened). A
   * token that isn't the open group's takes nothing back (and warns).
   */
  abortGroup: (token: UndoGroupToken, description: string) => Promise<boolean>
  /**
   * Runs `fn` as one compound operation: after every group run before it
   * has settled, inside a group of its own (`fn` gets its token). When `fn`
   * settles — resolves or throws — with the group still open, the group
   * ends as one entry named `description` (a function: read then, e.g. a
   * count of what went in) with the undo snackbar; `fn` may close it itself
   * first (`abortGroup` on a failure). Resolves / rejects as `fn` does.
   *
   * Every compound operation (Eisenhower drops, check-in replies) goes
   * through here, so groups never overlap. An unrelated undoable write that
   * lands while a group is open (a user edit in the milliseconds a drop
   * takes) is still merged into it — accepted: groups are short, and
   * nothing but these writes runs between their awaits in practice.
   */
  runGroup: <T>(description: string | (() => string), fn: (token: UndoGroupToken) => Promise<T>) => Promise<T>
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
    groupToken: null,
    snackbar: null,
    snackbarTimerId: null,

    push(entry: UndoEntry, showSnackbar = false) {
      const { undoStack, snackbarTimerId, groupStartIndex } = get()
      // Inside a group the stack is not trimmed (that would shift the group's
      // start; `endGroup` trims) and no snackbar shows (`endGroup` decides).
      const inGroup = groupStartIndex != null
      const into = entry.mergeKey === undefined ? null : get().mergeTarget(entry.mergeKey)
      // A merge: the newest step keeps its undo (back to before the run) and
      // its name, and takes this push's redo.
      const top = into ? { ...into, redo: entry.redo } : entry
      const base = into ? undoStack.slice(0, -1) : undoStack
      const trimmed = !inGroup && base.length >= MAX_STACK_SIZE
        ? base.slice(base.length - MAX_STACK_SIZE + 1)
        : base

      if (snackbarTimerId != null) clearTimeout(snackbarTimerId)

      if (showSnackbar && !inGroup) {
        // A second line is more to read: it stays as long as a notice.
        const timerId = endSnackbarAfter(top.detail ? NOTICE_SNACKBAR_MS : UNDO_SNACKBAR_MS)
        set({
          undoStack: [...trimmed, top],
          redoStack: [],
          snackbar: {
            description: top.description,
            ...(top.detail ? { detail: top.detail } : {}),
            ...(top.action ? { action: top.action } : {}),
          },
          snackbarTimerId: timerId,
        })
      } else {
        set({
          undoStack: [...trimmed, top],
          redoStack: [],
          snackbar: null,
          snackbarTimerId: null,
        })
      }
      return top
    },

    mergeTarget(mergeKey: string) {
      const { undoStack, groupStartIndex } = get()
      const top = undoStack.at(-1)
      return groupStartIndex == null && top?.mergeKey === mergeKey ? top : null
    },

    dropNewest(entry: UndoEntry) {
      const { undoStack } = get()
      if (undoStack.at(-1) === entry) set({ undoStack: undoStack.slice(0, -1) })
    },

    async undo() {
      if (get().groupToken != null) await groupsSettled(() => get().groupToken != null)
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
        if (e instanceof UndoGone) {
          // Gone for good: dropped, and the next undo reaches the step before it.
          set({ isPerformingUndoRedo: false })
          get().notify(e.message)
          return
        }
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
      if (get().groupToken != null) await groupsSettled(() => get().groupToken != null)
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
        if (e instanceof UndoGone) {
          set({ isPerformingUndoRedo: false })
          get().notify(e.message)
          return
        }
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
      if (get().groupToken != null) console.warn('[undo] a group was opened while another was open')
      const token: UndoGroupToken = { __undoGroup: true }
      set({ groupStartIndex: get().undoStack.length, groupToken: token })
      return token
    },

    endGroup(token: UndoGroupToken, description: string, showSnackbar = false) {
      const { undoStack, groupStartIndex, groupToken, snackbarTimerId } = get()
      if (groupStartIndex == null || groupToken !== token) {
        console.warn(`[undo] endGroup for a group that isn't open: ${description}`)
        return
      }

      const grouped = undoStack.slice(groupStartIndex)
      if (grouped.length === 0) {
        set({ groupStartIndex: null, groupToken: null })
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
          groupToken: null,
          snackbar: { description },
          snackbarTimerId: timerId,
        })
      } else {
        set({
          undoStack: [...trimmed, compound],
          redoStack: [],
          groupStartIndex: null,
          groupToken: null,
          snackbar: null,
          snackbarTimerId: null,
        })
      }
    },

    async abortGroup(token: UndoGroupToken, description: string) {
      const { undoStack, groupStartIndex, groupToken } = get()
      if (groupStartIndex == null || groupToken !== token) {
        console.warn(`[undo] abortGroup for a group that isn't open: ${description}`)
        return true
      }
      const grouped = undoStack.slice(groupStartIndex)
      // Like an undo: the stores' writes made while taking back push nothing.
      set({ undoStack: undoStack.slice(0, groupStartIndex), groupStartIndex: null, groupToken: null, isPerformingUndoRedo: true })
      try {
        for (let i = grouped.length - 1; i >= 0; i--) {
          const entry = grouped[i]
          if (!entry) continue
          try {
            await entry.undo()
          } catch (e) {
            // Its subject is gone: nothing of it is left to take back.
            if (e instanceof UndoGone) continue
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

    runGroup<T>(description: string | (() => string), fn: (token: UndoGroupToken) => Promise<T>): Promise<T> {
      const run = groupQueue.then(async () => {
        const token = get().beginGroup()
        try {
          return await fn(token)
        } finally {
          if (get().groupToken === token) {
            get().endGroup(token, typeof description === 'function' ? description() : description, true)
          }
        }
      })
      // A group that failed doesn't stop the ones after it.
      groupQueue = run.catch(() => {})
      return run
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
      set({ undoStack: [], redoStack: [], groupStartIndex: null, groupToken: null, snackbar: null, snackbarTimerId: null })
    },
  }
})
