import { describe, it, expect } from 'vitest'
import { TAG_MAX_LEN, normalizeTag } from '../../utils/tags'

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
