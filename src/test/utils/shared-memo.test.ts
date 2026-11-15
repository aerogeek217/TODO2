import { describe, expect, it, vi } from 'vitest'
import { FRESH_MISSES_WARN, SHARED_MEMO_WARNING, sameElements, sharedMemo, sharedMemoByKey } from '../../utils/shared-memo'

describe('sharedMemo', () => {
  it('computes once per set of inputs, compared by identity', () => {
    const compute = vi.fn((xs: readonly number[], k: number) => xs.map((x) => x * k))
    const memo = sharedMemo(compute)
    const xs = [1, 2]
    const a = memo(xs, 2)
    expect(memo(xs, 2)).toBe(a)
    expect(compute).toHaveBeenCalledTimes(1)
    // A new array with the same items is a new input.
    expect(memo([1, 2], 2)).not.toBe(a)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('keeps the last few input sets, so two callers with different options both hit', () => {
    const compute = vi.fn((xs: readonly number[], k: number) => xs.length * k)
    const memo = sharedMemo(compute, 2)
    const xs = [1]
    memo(xs, 3)
    memo(xs, 7)
    memo(xs, 3)
    memo(xs, 7)
    expect(compute).toHaveBeenCalledTimes(2)
    // A third set evicts the least recently used one (3 was read before 7).
    memo(xs, 9)
    memo(xs, 7)
    expect(compute).toHaveBeenCalledTimes(3)
    memo(xs, 3)
    expect(compute).toHaveBeenCalledTimes(4)
  })

  it('`same`: a new input set that computes the same as the newest value returns that value again', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    const memo = sharedMemo((xs: readonly object[], key: object) => (key ? xs.filter(() => true) : []), 8, sameElements)
    const first = memo([a, b], {})
    expect(memo([a, b], {})).toBe(first)
    expect(memo([a], {})).not.toBe(first)
    expect(sameElements([a, b], [a, b])).toBe(true)
    expect(sameElements([a, b], [b, a])).toBe(false)
    expect(sameElements([a], [a, b])).toBe(false)
  })

  it('keeps one input set by default: a new one lets the old arrays go', () => {
    const compute = vi.fn((xs: readonly number[]) => xs.length)
    const memo = sharedMemo(compute)
    const a = [1]
    const b = [1, 2]
    memo(a)
    memo(b)
    memo(a)
    expect(compute).toHaveBeenCalledTimes(3)
  })

  it('warns once, in development, when a caller keeps passing a fresh input equal to a kept one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const memo = sharedMemo(function picks(ids: readonly number[], opts: { days: number }) { return ids.length * opts.days })
    const ids = [1, 2]
    for (let i = 0; i <= FRESH_MISSES_WARN + 2; i++) memo(ids, { days: 7 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toContain(SHARED_MEMO_WARNING)
    expect(String(warn.mock.calls[0]![0])).toContain('picks')
    warn.mockRestore()
  })

  it('no warning for store-like inputs: the same values hit, a real change misses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const memo = sharedMemo((ids: readonly number[], opts: { days: number }) => ids.length * opts.days)
    const opts = { days: 7 }
    let ids = [1]
    for (let i = 0; i < 10; i++) {
      memo(ids, opts)
      memo(ids, opts)
      ids = [...ids, i + 2]
    }
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

// cr34 G8 / M12: what the glance widgets' memos lean on.
describe('sharedMemo: two input sets asked for in turn', () => {
  it('`same` finds the kept value among every kept set, not only the newest', () => {
    const a = { id: 1 }
    const b = { id: 2 }
    // Two callers, `lensed` and `unlensed`, each with its own first input; the task array changes under both.
    const lensed = {}
    const unlensed = {}
    const memo = sharedMemo((_which: object, xs: readonly object[]) => xs.filter((x) => x !== b), 2, sameElements)
    const first = memo(lensed, [a, b])
    const other = memo(unlensed, [a, b])
    // The same elements: the two sets share one array.
    expect(other).toBe(first)
    // A write hands both a new array holding the same tasks: each gets its kept array back,
    // though the newest kept entry is the other caller's each time.
    const again = [a, b]
    expect(memo(lensed, again)).toBe(first)
    expect(memo(unlensed, again)).toBe(first)
  })

  it('`peek` returns a kept value without computing, and nothing for inputs it doesn’t hold', () => {
    const compute = vi.fn((xs: readonly number[]) => xs.length)
    const memo = sharedMemo(compute)
    const xs = [1, 2, 3]
    expect(memo.peek(xs)).toBeUndefined()
    expect(compute).not.toHaveBeenCalled()
    expect(memo(xs)).toBe(3)
    expect(memo.peek(xs)).toBe(3)
    expect(memo.peek([1, 2, 3])).toBeUndefined()
    expect(compute).toHaveBeenCalledTimes(1)
  })
})

describe('sharedMemoByKey', () => {
  it('keeps one input set per key by default: callers with different keys never evict each other', () => {
    const compute = vi.fn((key: { n: number }, xs: readonly number[]) => key.n + xs.length)
    const memo = sharedMemoByKey(compute)
    const k1 = { n: 1 }
    const k2 = { n: 2 }
    const xs = [1, 2]
    expect(memo(k1, xs)).toBe(3)
    expect(memo(k2, xs)).toBe(4)
    expect(memo(k1, xs)).toBe(3)
    expect(compute).toHaveBeenCalledTimes(2)
    // One slot: the same key with other inputs replaces its set.
    memo(k1, [1])
    memo(k1, xs)
    expect(compute).toHaveBeenCalledTimes(4)
  })

  it('with two slots, two callers sharing a key and differing by one input both hit', () => {
    const compute = vi.fn((_key: object, screen: object, xs: readonly number[]) => ({ screen, n: xs.length }))
    const memo = sharedMemoByKey(compute, undefined, 2)
    const key = {}
    const withLens = {}
    const without = {}
    const xs = [1, 2]
    const a = memo(key, withLens, xs)
    const b = memo(key, without, xs)
    expect(memo(key, withLens, xs)).toBe(a)
    expect(memo(key, without, xs)).toBe(b)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('`peek` only looks; `last` is what the key computed last, with its inputs', () => {
    const compute = vi.fn((key: { n: number }, xs: readonly number[]) => key.n + xs.length)
    const memo = sharedMemoByKey(compute)
    const key = { n: 1 }
    const xs = [1, 2]
    expect(memo.peek(key, xs)).toBeUndefined()
    expect(memo.last(key)).toBeUndefined()
    expect(compute).not.toHaveBeenCalled()
    memo(key, xs)
    expect(memo.peek(key, xs)).toBe(3)
    expect(memo.peek(key, [1, 2])).toBeUndefined()
    expect(memo.last(key)).toEqual({ deps: [xs], value: 3 })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('`same` returns the kept value a new input set computes again', () => {
    const memo = sharedMemoByKey((_key: object, xs: readonly object[]) => [...xs], sameElements)
    const key = {}
    const a = { id: 1 }
    const first = memo(key, [a])
    expect(memo(key, [a])).toBe(first)
  })
})
