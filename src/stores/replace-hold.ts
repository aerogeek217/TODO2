import { registerModuleReset } from '../utils/module-reset'
import { UndoRefused, useUndoStore } from './undo-store'

/**
 * The hold a data replace keeps on layout and list writes
 * (`services/replace-data.replaceData`): from just before its database write
 * until the stores have reloaded the new data. In that window the workspace
 * and list stores still hold the replaced data in memory, and their writes
 * put whole rows (`layoutRepository.putAndPrune`, a list's `put`) — an edit
 * made then would write the old layout or list over the new data, and prune
 * the new data's lists by the old layout's tabs. So while it is held those
 * writes don't run: an edit changes nothing and says why, an undo of one is
 * refused (the step stays — the reload then clears the stack), view state
 * isn't written. Nested holds count.
 */
let holds = 0
registerModuleReset(() => { holds = 0 })

/** What must land before a replace writes (`registerReplaceSettle`): the workspace's layout writes in flight. */
const settles = new Set<() => Promise<void>>()

/**
 * Registers `settle`, which resolves once the module's writes already
 * running have landed with what follows them (`workspace-store`'s layout
 * writes: their removed lists taken into the stores) — awaited by
 * `settleBeforeReplace`, so none of it lands over the new data.
 */
export function registerReplaceSettle(settle: () => Promise<void>): void {
  settles.add(settle)
}

/** Resolves once every registered settle has (a replace's write waits for it, under its hold). */
export async function settleBeforeReplace(): Promise<void> {
  await Promise.all([...settles].map((settle) => settle()))
}

/** Starts a hold; returns its release (a second call does nothing). */
export function beginReplaceHold(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
  }
}

/** Whether a data replace holds layout and list writes now. */
export function replaceHoldActive(): boolean {
  return holds > 0
}

/** What an edit refused under the hold says. */
const HELD_MESSAGE = 'Your data is being replaced — try again in a moment.'

/**
 * Under the hold: says so (the snackbar) and returns true — the caller then
 * changes nothing. Else false.
 */
export function refusedByReplaceHold(): boolean {
  if (holds === 0) return false
  useUndoStore.getState().notify(HELD_MESSAGE)
  return true
}

/** Under the hold: throws `UndoRefused` (an undo / redo that would write; the step stays). */
export function assertNoReplaceHold(): void {
  if (holds > 0) throw new UndoRefused(HELD_MESSAGE)
}
