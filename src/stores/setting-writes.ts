import { trackWrite } from './store-helpers'
import { useUndoStore } from './undo-store'
import { undoable } from './undoable'

/** The part of a store a setting write reads and writes. */
export interface SettingStore<S> {
  getState: () => S
  setState: (partial: Partial<S>) => void
}

/**
 * Shows one setting's new value at once, then saves it with `persist`; a
 * failed save puts the value before it back and resolves false — only where
 * the store still shows this write's value: a later write (a quick second
 * pick, saved first) or a reload since keeps its own. Says nothing: the
 * caller does (`recordSettingWrite`, or its own notice).
 */
export function writeSetting<S, K extends keyof S>(
  store: SettingStore<S>,
  patch: Pick<S, K>,
  persist: () => Promise<void>,
  label: string,
): Promise<boolean> {
  return trackWrite(async () => {
    const keys = Object.keys(patch) as K[]
    const state = store.getState()
    const prev = Object.fromEntries(keys.map((k) => [k, state[k]])) as Pick<S, K>
    store.setState(patch as Partial<S>)
    try {
      await persist()
      return true
    } catch (e) {
      console.error(`Failed to save ${label}:`, e)
      const now = store.getState()
      const back = keys.filter((k) => Object.is(now[k], patch[k]))
      if (back.length > 0) store.setState(Object.fromEntries(back.map((k) => [k, prev[k]])) as unknown as Partial<S>)
      return false
    }
  })
}

/**
 * A settings change as one undo step with the undo snackbar (Settings, where
 * these are changed, takes no Ctrl+Z): `write` shows and saves it, `revert`
 * puts the value before it back. A failed save adds no step and says so
 * (the snackbar's notice, `failure`); its undo / redo rejects when its write
 * fails, so the undo store keeps the entry and says so. Resolves whether it
 * was saved.
 */
export async function recordSettingWrite(
  description: string,
  write: () => Promise<boolean>,
  revert: () => Promise<boolean>,
  failure: string,
): Promise<boolean> {
  if (!(await write())) {
    useUndoStore.getState().notify(failure)
    return false
  }
  const must = async (run: () => Promise<boolean>) => {
    if (!(await run())) throw new Error('The setting could not be saved')
  }
  undoable(description, () => must(write), () => must(revert), true)
  return true
}
