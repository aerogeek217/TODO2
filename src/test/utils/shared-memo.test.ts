import { describe, expect, it, vi } from 'vitest'
import { FRESH_MISSES_WARN, SHARED_MEMO_WARNING, sameElements, sharedMemo } from '../../utils/shared-memo'

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
