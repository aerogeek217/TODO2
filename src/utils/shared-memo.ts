import { registerModuleReset } from './module-reset'

/**
 * A memo shared by every caller: `compute` runs once per set of inputs, and
 * every component asking with the same inputs (each compared by identity)
 * gets the same value — so a dozen widgets reading one statistic compute it
 * once, where a `useMemo` in each would compute it a dozen times. The last
 * `size` input sets are kept (two widgets with different options don't
 * evict each other). Inputs must be store values or other shared memos'
 * results: a fresh object per render never hits.
 *
 * `same` (optional): when a new input set computes a value `same` as the
 * newest one kept, that kept value is returned again — so memos keyed on
 * it still hit (an input changed that this result doesn't show).
 */
export function sharedMemo<D extends readonly unknown[], T>(
  compute: (...deps: D) => T,
  size = 8,
  same?: (kept: T, next: T) => boolean,
): (...deps: D) => T {
  let entries: Array<{ deps: D; value: T }> = []
  registerModuleReset(() => { entries = [] })
  return (...deps: D): T => {
    const hit = entries.find((e) => e.deps.length === deps.length && e.deps.every((d, i) => Object.is(d, deps[i])))
    if (hit) {
      // Most recent first, so the oldest goes when the cache is full.
      if (entries[0] !== hit) entries = [hit, ...entries.filter((e) => e !== hit)]
      return hit.value
    }
    const computed = compute(...deps)
    const newest = entries[0]
    const value = newest && same?.(newest.value, computed) ? newest.value : computed
    entries = [{ deps, value }, ...entries].slice(0, size)
    return value
  }
}

/** Whether two arrays hold the same elements (by identity) in the same order. */
export function sameElements<E>(a: readonly E[], b: readonly E[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
}
