import { settingsRepository } from '../data'
import { registerModuleReset } from '../utils/module-reset'
import { trackWrite } from './store-helpers'
import { useUndoStore, type UndoEntry } from './undo-store'

/**
 * The one way a setting is written (TODO M6): every setting is a
 * {@link SettingSpec} — the store fields it shows, how they are read from
 * and written to the `settings` rows, its undo step and its failure notice —
 * and {@link settingWriter} turns it into its writer.
 */

/** The part of a store a setting write reads and writes. */
export interface SettingStore<S> {
  getState: () => S
  setState: (partial: Partial<S>) => void
}

/** The `settings` rows by key, as `load` reads them. */
export type StoredRows = ReadonlyMap<string, string>

/** A setting's rows: a string puts the row, `null` deletes it (absent = the default). */
export type SettingRows = Readonly<Record<string, string | null>>

/** How one setting is read from its rows (every setting has this; some are written elsewhere). */
export interface StoredSetting<S, K extends keyof S> {
  /** The store fields it shows. */
  fields: readonly K[]
  /** Its value from the stored rows; an absent or unreadable row gives the default. */
  read: (rows: StoredRows) => Pick<S, K>
}

/** A setting this mechanism writes: `read` and `rows` are inverses. */
export interface SettingSpec<S, K extends keyof S> extends StoredSetting<S, K> {
  /** Every row that stores `value`. */
  rows: (value: Pick<S, K>) => SettingRows
  /** What a failed save logs: `Failed to save <label>`. */
  label: string
  /** The snackbar's notice when a save fails; omitted: only logged (internal bookkeeping). */
  failure?: string
  /** The undo step's name for a saved change to `value`; omitted: no undo step unless the write names one. */
  undo?: (value: Pick<S, K>) => string
  /** Runs whenever the writer shows a value — a write, a rollback, an undo / redo (e.g. the theme on the page). */
  shown?: () => void
}

export interface SettingWriteOptions {
  /** The undo step's name, instead of the spec's (the lenses'). */
  description?: string
  /**
   * Writes passing the same key one after another (while their step is the
   * newest) stay one undo step, without the snackbar — a name typed letter
   * by letter; typed back to where it started, the step goes.
   */
  mergeKey?: string
  /** `false`: no undo step — a caller that records its own (a status delete clearing the default status). */
  record?: boolean
}

export interface SettingWriter<S, K extends keyof S> {
  /**
   * Shows `value` at once and saves it, after this setting's writes before
   * it. A saved change is one undo step (the spec's `undo`, or
   * `options.description`) with the undo snackbar, putting back the value
   * saved before it; a failed save adds none and says so (`failure`). The
   * same value again writes nothing. Resolves whether it is saved.
   */
  write: (value: Pick<S, K>, options?: SettingWriteOptions) => Promise<boolean>
}

/** Bumped by the test reset: a write left in flight settles without touching the new state. */
let generation = 0
registerModuleReset(() => { generation++ })

function sameRows(a: SettingRows, b: SettingRows): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
}

/** One row alone through `put` / `delete`; several in one transaction (`writeMany`), so a failure never leaves part saved. */
async function persistRows(rows: SettingRows): Promise<void> {
  const entries = Object.entries(rows)
  const [only] = entries
  if (entries.length !== 1 || !only) return settingsRepository.writeMany(rows)
  const [key, value] = only
  if (value === null) await settingsRepository.delete(key)
  else await settingsRepository.put(key, value)
}

/** A save's outcome: whether it was saved, and the value saved before it (what its undo puts back). */
interface Save<V> {
  ok: boolean
  before: V
  /** The test reset ran meanwhile: nothing more to do. */
  stale?: true
}

/**
 * The writer for one setting. Writes are serialized: each shows its value
 * at once, then saves it once the writes before it have settled. When no
 * write is left, a failed one leaves the field on the value last saved —
 * only where it still shows the newest write's value (a reload since keeps
 * its own) — so a write failing after a later one was shown never leaves
 * the screen and the database apart.
 */
export function settingWriter<S, K extends keyof S>(store: SettingStore<S>, spec: SettingSpec<S, K>): SettingWriter<S, K> {
  type V = Pick<S, K>
  const pick = (state: S): V => Object.fromEntries(spec.fields.map((f) => [f, state[f]])) as V
  const show = (value: Partial<V>) => {
    store.setState(value as Partial<S>)
    spec.shown?.()
  }

  let epoch = generation
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0
  // Both are set by the first write (nothing in flight: what shows is saved).
  /** The value last saved (the database's, not the one shown). */
  let saved = {} as V
  /** The newest write's value. */
  let newest = saved
  /**
   * This writer's newest merged step (`UndoEntry.mergeKey`) and the value
   * saved before its run, to tell when a run comes back to where it started.
   */
  let merging: { entry: UndoEntry; prev: V } | null = null

  function save(value: V): Promise<Save<V>> {
    return trackWrite(() => {
      if (epoch !== generation) {
        epoch = generation
        queue = Promise.resolve()
        pending = 0
        merging = null
      }
      const gen = epoch
      // Nothing in flight: what is shown is what is saved.
      if (pending === 0) saved = pick(store.getState())
      pending++
      newest = value
      show(value)
      const run = queue.then(async (): Promise<Save<V>> => {
        const before = saved
        let ok = true
        try {
          await persistRows(spec.rows(value))
        } catch (e) {
          ok = false
          console.error(`Failed to save ${spec.label}:`, e)
        }
        if (gen !== generation) return { ok, before, stale: true }
        if (ok) saved = value
        pending--
        if (pending === 0) {
          const state = store.getState()
          const back = spec.fields.filter((f) => Object.is(state[f], newest[f]) && !Object.is(saved[f], newest[f]))
          if (back.length > 0) show(Object.fromEntries(back.map((f) => [f, saved[f]])) as Partial<V>)
        }
        return { ok, before }
      })
      queue = run
      return run
    })
  }

  /** For an undo / redo: rejects when the save fails, so the undo store keeps the entry and says so. */
  async function mustSave(value: V): Promise<void> {
    if (!(await save(value)).ok) throw new Error('The setting could not be saved')
  }

  function record(before: V, next: V, description: string, mergeKey: string | undefined): void {
    const undo = useUndoStore.getState()
    if (undo.isPerformingUndoRedo) return
    // The run this write continues: this writer's newest step, still the
    // newest on the stack with the same key (the undo store's merge rule).
    const into = mergeKey === undefined ? null : undo.mergeTarget(mergeKey)
    const last = into && merging?.entry === into ? merging : null
    if (into && last && sameRows(spec.rows(last.prev), spec.rows(next))) {
      // Typed back to where it started (a letter typed, then erased): no step left to undo.
      undo.dropNewest(into)
      merging = null
      return
    }
    // Another writer's step under the same key isn't this run's: a step of its own (unkeyed).
    const keyed = mergeKey !== undefined && !(into && !last)
    const entry: UndoEntry = {
      description,
      undo: () => mustSave(before),
      redo: () => mustSave(next),
      ...(keyed ? { mergeKey } : {}),
    }
    const top = undo.push(entry, mergeKey === undefined)
    merging = keyed ? { entry: top, prev: last ? last.prev : before } : null
  }

  return {
    async write(value, options = {}) {
      const now = pick(store.getState())
      const nextRows = spec.rows(value)
      if (sameRows(spec.rows(now), nextRows) && spec.fields.every((f) => JSON.stringify(now[f]) === JSON.stringify(value[f]))) return true
      const result = await save(value)
      if (result.stale) return result.ok
      if (!result.ok) {
        if (spec.failure) useUndoStore.getState().notify(spec.failure)
        return false
      }
      const description = options.description ?? spec.undo?.(value)
      // Only what shows changed (the same rows stored again): no step of its own.
      if (description !== undefined && options.record !== false && !sameRows(spec.rows(result.before), nextRows)) {
        record(result.before, value, description, options.mergeKey)
      }
      return true
    },
  }
}
