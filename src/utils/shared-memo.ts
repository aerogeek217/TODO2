import { registerModuleReset } from './module-reset'

/**
 * A memo shared by every caller: `compute` runs once per set of inputs, and
 * every component asking with the same inputs (each compared by identity)
 * gets the same value — so a dozen widgets reading one statistic compute it
 * once, where a `useMemo` in each would compute it a dozen times.
 *
 * `size`: how many input sets are kept. Inputs like the task arrays change on
 * every write, so a kept older set only holds stale arrays and results: a
 * memo every caller asks with the same inputs keeps one (the default); a memo
 * whose callers differ by an option (a look-ahead, a day count) keeps one per
 * choice, so two widgets with different options don't evict each other.
 *
 * **Identity keys.** Inputs must be store values or other shared memos'
 * results: a fresh object per render never hits. In development a memo that
 * misses `FRESH_MISSES_WARN` times in a row on inputs equal to a kept set's
 * but not identical (a spread, a `?? []`, an object literal) warns once —
 * the tests fail on it (`src/test/utils/shared-memo.test.ts`, and the glance
 * widgets' shared-data test renders every memo's callers).
 *
 * `same` (optional): when a new input set computes a value `same` as the
 * newest one kept, that kept value is returned again — so memos keyed on
 * it still hit (an input changed that this result doesn't show).
 */
export function sharedMemo<D extends readonly unknown[], T>(
  compute: (...deps: D) => T,
  size = 1,
  same?: (kept: T, next: T) => boolean,
): (...deps: D) => T {
  let entries: Array<{ deps: D; value: T }> = []
  let freshMisses = 0
  let warned = false
  registerModuleReset(() => {
    entries = []
    freshMisses = 0
    warned = false
  })
  return (...deps: D): T => {
    const hit = entries.find((e) => e.deps.length === deps.length && e.deps.every((d, i) => Object.is(d, deps[i])))
    if (hit) {
      freshMisses = 0
      // Most recent first, so the oldest goes when the cache is full.
      if (entries[0] !== hit) entries = [hit, ...entries.filter((e) => e !== hit)]
      return hit.value
    }
    if (import.meta.env.DEV) {
      freshMisses = entries.some((e) => sameInputs(e.deps, deps)) ? freshMisses + 1 : 0
      if (freshMisses >= FRESH_MISSES_WARN && !warned) {
        warned = true
        console.warn(`${SHARED_MEMO_WARNING} (${compute.name || 'anonymous'}): an input is a fresh object equal to the last one — pass a store value or a shared memo's result.`)
      }
    }
    const computed = compute(...deps)
    const newest = entries[0]
    const value = newest && same?.(newest.value, computed) ? newest.value : computed
    entries = [{ deps, value }, ...entries].slice(0, size)
    return value
  }
}

/** Misses in a row on equal-but-not-identical inputs before a development warning. */
export const FRESH_MISSES_WARN = 3

/** The development warning's start, for the tests that fail on it. */
export const SHARED_MEMO_WARNING = 'sharedMemo keeps missing'

/** Whether two input sets are equal one level deep (arrays element by element, plain objects key by key). */
function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => shallowEqual(x, b[i]))
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) return sameElements(a, b)
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is(a[k], b[k]))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Whether two arrays hold the same elements (by identity) in the same order. */
export function sameElements<E>(a: readonly E[], b: readonly E[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
}

/**
 * `sharedMemo` with one input set kept per `key` (an object, held weakly):
 * for a statistic each caller asks with its own key — a Number's filter —
 * so any number of them on screen never evict one another. The rest of the
 * inputs compare by identity, as in `sharedMemo`; `same` compares a new
 * value with the one this key kept.
 */
export function sharedMemoByKey<K extends object, D extends readonly unknown[], T>(
  compute: (key: K, ...deps: D) => T,
  same?: (kept: T, next: T) => boolean,
): (key: K, ...deps: D) => T {
  let entries = new WeakMap<K, { deps: D; value: T }>()
  registerModuleReset(() => {
    entries = new WeakMap()
  })
  return (key: K, ...deps: D): T => {
    const kept = entries.get(key)
    if (kept && kept.deps.length === deps.length && kept.deps.every((d, i) => Object.is(d, deps[i]))) return kept.value
    const computed = compute(key, ...deps)
    const value = kept && same?.(kept.value, computed) ? kept.value : computed
    entries.set(key, { deps, value })
    return value
  }
}
