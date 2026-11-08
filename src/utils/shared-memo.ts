import { registerModuleReset } from './module-reset'

/**
 * A memo shared by every caller: `compute` runs once per set of inputs, and
 * every component asking with the same inputs (each compared by identity)
 * gets the same value — so a dozen widgets reading one statistic compute it
 * once, where a `useMemo` in each would compute it a dozen times. The last
 * `size` input sets are kept (two widgets with different options don't
 * evict each other). Inputs must be store values or other shared memos'
 * results: a fresh object per render never hits.
 */
export function sharedMemo<D extends readonly unknown[], T>(compute: (...deps: D) => T, size = 8): (...deps: D) => T {
  let entries: Array<{ deps: D; value: T }> = []
  registerModuleReset(() => { entries = [] })
  return (...deps: D): T => {
    const hit = entries.find((e) => e.deps.length === deps.length && e.deps.every((d, i) => Object.is(d, deps[i])))
    if (hit) {
      // Most recent first, so the oldest goes when the cache is full.
      if (entries[0] !== hit) entries = [hit, ...entries.filter((e) => e !== hit)]
      return hit.value
    }
    const value = compute(...deps)
    entries = [{ deps, value }, ...entries].slice(0, size)
    return value
  }
}
