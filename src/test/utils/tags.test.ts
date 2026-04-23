import { describe, it, expect } from 'vitest'
import {
  TAG_MAX_LEN,
  normalizeTag,
  normalizeTags,
  renameTagInArray,
  tagsEqual,
} from '../../utils/tags'

describe('normalizeTag', () => {
  it('trims + lowercases valid slugs', () => {
    expect(normalizeTag('  URGENT  ')).toBe('urgent')
    expect(normalizeTag('ToDoTodo')).toBe('todotodo')
    expect(normalizeTag('foo-bar_1')).toBe('foo-bar_1')
  })

  it('rejects empty / whitespace-only', () => {
    expect(normalizeTag('')).toBeNull()
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('\t\n')).toBeNull()
  })

  it('rejects non-string inputs', () => {
    expect(normalizeTag(undefined as unknown as string)).toBeNull()
    expect(normalizeTag(null as unknown as string)).toBeNull()
    expect(normalizeTag(42 as unknown as string)).toBeNull()
  })

  it('rejects slugs with spaces or punctuation outside `_-`', () => {
    expect(normalizeTag('foo bar')).toBeNull()
    expect(normalizeTag('foo!')).toBeNull()
    expect(normalizeTag('foo.bar')).toBeNull()
    expect(normalizeTag('foo/bar')).toBeNull()
    expect(normalizeTag('foo#bar')).toBeNull()
  })

  it('rejects non-ASCII chars', () => {
    expect(normalizeTag('fooñ')).toBeNull()
    expect(normalizeTag('日本語')).toBeNull()
  })

  it('enforces TAG_MAX_LEN', () => {
    const max = 'a'.repeat(TAG_MAX_LEN)
    const tooLong = 'a'.repeat(TAG_MAX_LEN + 1)
    expect(normalizeTag(max)).toBe(max)
    expect(normalizeTag(tooLong)).toBeNull()
  })

  it('accepts numeric-only slugs', () => {
    expect(normalizeTag('123')).toBe('123')
  })
})

describe('normalizeTags', () => {
  it('drops invalid entries and dedupes first-seen', () => {
    expect(normalizeTags(['Alpha', 'alpha', '', 'BAD!', 'beta', 'Alpha']))
      .toEqual(['alpha', 'beta'])
  })

  it('returns empty on all-invalid input', () => {
    expect(normalizeTags(['', '   ', 'bad char!', null as unknown as string]))
      .toEqual([])
  })

  it('preserves order from first occurrence', () => {
    expect(normalizeTags(['gamma', 'alpha', 'BETA', 'alpha']))
      .toEqual(['gamma', 'alpha', 'beta'])
  })

  it('handles empty input', () => {
    expect(normalizeTags([])).toEqual([])
  })
})

describe('renameTagInArray', () => {
  it('reports unchanged when src is absent', () => {
    const res = renameTagInArray(['alpha', 'beta'], 'gamma', 'delta')
    expect(res.changed).toBe(false)
    expect(res.next).toEqual(['alpha', 'beta'])
  })

  it('rewrites src to dst in place when dst is new', () => {
    const res = renameTagInArray(['alpha', 'beta'], 'alpha', 'delta')
    expect(res.changed).toBe(true)
    expect(res.next).toEqual(['delta', 'beta'])
  })

  it('dedupes when dst already exists later', () => {
    const res = renameTagInArray(['alpha', 'beta'], 'alpha', 'beta')
    expect(res.changed).toBe(true)
    expect(res.next).toEqual(['beta'])
  })

  it('keeps first-seen dst position when dst precedes src', () => {
    const res = renameTagInArray(['beta', 'alpha'], 'alpha', 'beta')
    expect(res.changed).toBe(true)
    expect(res.next).toEqual(['beta'])
  })

  it('does not mutate input', () => {
    const input = ['alpha', 'beta']
    const res = renameTagInArray(input, 'alpha', 'gamma')
    expect(input).toEqual(['alpha', 'beta'])
    expect(res.next).not.toBe(input)
  })

  it('handles empty input', () => {
    const res = renameTagInArray([], 'alpha', 'beta')
    expect(res.changed).toBe(false)
    expect(res.next).toEqual([])
  })
})

describe('tagsEqual', () => {
  it('treats undefined and empty array as equal', () => {
    expect(tagsEqual(undefined, [])).toBe(true)
    expect(tagsEqual([], undefined)).toBe(true)
    expect(tagsEqual(undefined, undefined)).toBe(true)
  })

  it('is order-sensitive', () => {
    expect(tagsEqual(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(tagsEqual(['a', 'b'], ['a', 'b'])).toBe(true)
  })

  it('distinguishes length differences', () => {
    expect(tagsEqual(['a'], ['a', 'b'])).toBe(false)
  })
})
