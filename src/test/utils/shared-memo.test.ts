import { describe, expect, it, vi } from 'vitest'
import { sameElements, sharedMemo } from '../../utils/shared-memo'

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
})
