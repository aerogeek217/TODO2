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
 * `same` (optional): when a new input set computes a value `same` as one
 * that is kept, that kept value is returned again — so memos keyed on it
 * still hit (an input changed that this result doesn't show). Any kept
 * entry's, not only the newest: a memo keeping two input sets its callers
 * ask for in turn (with the top bar's lens and without it) has the other
 * set as its newest each time (cr34 G8).
 *
 * `peek`: the kept value for these inputs, without computing (`undefined`
 * when it isn't kept) — for a caller that computes off its render.
 */
export function sharedMemo<D extends readonly unknown[], T>(
  compute: (...deps: D) => T,
  size = 1,
  same?: (kept: T, next: T) => boolean,
): SharedMemo<D, T> {
  let entries: Array<{ deps: D; value: T }> = []
  let freshMisses = 0
  let warned = false
  registerModuleReset(() => {
    entries = []
    freshMisses = 0
    warned = false
  })
  const find = (deps: D) => entries.find((e) => sameDeps(e.deps, deps))
  const memo = (...deps: D): T => {
    const hit = find(deps)
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
    const value = keptSame(entries, compute(...deps), same)
    entries = [{ deps, value }, ...entries].slice(0, size)
    return value
  }
  memo.peek = (...deps: D): T | undefined => find(deps)?.value
  return memo
}

/** A shared memo: called, it computes or returns the kept value; `peek` only looks. */
interface SharedMemo<D extends readonly unknown[], T> {
  (...deps: D): T
  peek(...deps: D): T | undefined
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((d, i) => Object.is(d, b[i]))
}

/** `computed`, or the kept value it is `same` as. */
function keptSame<T>(entries: ReadonlyArray<{ value: T }>, computed: T, same: ((kept: T, next: T) => boolean) | undefined): T {
  if (!same) return computed
  const kept = entries.find((e) => same(e.value, computed))
  return kept ? kept.value : computed
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
 * `sharedMemo` with its input sets kept per `key` (an object, held weakly):
 * for a statistic each caller asks with its own key — a Number's filter —
 * so any number of them on screen never evict one another. The rest of the
 * inputs compare by identity, as in `sharedMemo`; `same` compares a new
 * value with the ones this key kept.
 *
 * `slots`: the input sets kept per key — one, or two where callers sharing a
 * key differ by one choice (two widgets with one filter, one following the
 * top bar's lens and one ignoring it: with one slot they evicted each other
 * on every render, cr34 G8).
 *
 * `peek`: the kept value for this key and these inputs, without computing;
 * `last`: what this key computed last, with the inputs it was computed from
 * (what a caller may show while it computes the current one off its render).
 */
export function sharedMemoByKey<K extends object, D extends readonly unknown[], T>(
  compute: (key: K, ...deps: D) => T,
  same?: (kept: T, next: T) => boolean,
  slots = 1,
): SharedMemoByKey<K, D, T> {
  let entries = new WeakMap<K, Array<{ deps: D; value: T }>>()
  registerModuleReset(() => {
    entries = new WeakMap()
  })
  const memo = (key: K, ...deps: D): T => {
    const kept = entries.get(key) ?? []
    const hit = kept.find((e) => sameDeps(e.deps, deps))
    if (hit) {
      // Most recent first, so the oldest goes when the key's slots are full.
      if (kept[0] !== hit) entries.set(key, [hit, ...kept.filter((e) => e !== hit)])
      return hit.value
    }
    const value = keptSame(kept, compute(key, ...deps), same)
    entries.set(key, [{ deps, value }, ...kept].slice(0, slots))
    return value
  }
  memo.peek = (key: K, ...deps: D): T | undefined => entries.get(key)?.find((e) => sameDeps(e.deps, deps))?.value
  memo.last = (key: K): { deps: D; value: T } | undefined => entries.get(key)?.[0]
  return memo
}

/** A shared memo by key: called, it computes or returns the kept value; `peek` and `last` only look. */
interface SharedMemoByKey<K extends object, D extends readonly unknown[], T> {
  (key: K, ...deps: D): T
  peek(key: K, ...deps: D): T | undefined
  last(key: K): { deps: D; value: T } | undefined
}
