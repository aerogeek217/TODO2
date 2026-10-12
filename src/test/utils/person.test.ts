import { describe, it, expect } from 'vitest'
import { generateInitials, looksLikeEmail, normalizeEmail, withEmail } from '../../utils/person'

describe('generateInitials', () => {
  it('"John Doe" → "JD"', () => {
    expect(generateInitials('John Doe')).toBe('JD')
  })

  it('single word "Alice" → "A"', () => {
    expect(generateInitials('Alice')).toBe('A')
  })

  it('three words → 3 chars', () => {
    expect(generateInitials('John Michael Doe')).toBe('JMD')
  })

  it('four+ words truncates to 3 chars', () => {
    expect(generateInitials('John Michael David Doe')).toBe('JMD')
  })

  it('extra whitespace handled', () => {
    expect(generateInitials('  John   Doe  ')).toBe('JD')
  })

  it('empty string → ""', () => {
    expect(generateInitials('')).toBe('')
  })
})

describe('person email helpers', () => {
  it('normalizeEmail trims and turns empty into absent', () => {
    expect(normalizeEmail('  ann@example.com ')).toBe('ann@example.com')
    expect(normalizeEmail('   ')).toBeUndefined()
    expect(normalizeEmail('')).toBeUndefined()
    expect(normalizeEmail(undefined)).toBeUndefined()
    expect(normalizeEmail(null)).toBeUndefined()
  })

  it('looksLikeEmail is a light x@y.z check', () => {
    for (const ok of ['a@b.co', 'ann.lee+work@mail.example.com', '  ann@example.org  ']) {
      expect(looksLikeEmail(ok), ok).toBe(true)
    }
    for (const bad of ['', 'ann', 'ann@', 'ann@example', '@example.com', 'ann lee@example.com', 'ann@@example.com', 'ann@example.']) {
      expect(looksLikeEmail(bad), bad).toBe(false)
    }
  })

  it('withEmail sets the trimmed email or drops the key', () => {
    expect(withEmail({ name: 'Ann', email: 'old@x.io' }, ' new@x.io ')).toEqual({ name: 'Ann', email: 'new@x.io' })
    const cleared = withEmail({ name: 'Ann', email: 'old@x.io' }, '  ')
    expect(cleared).toEqual({ name: 'Ann' })
    expect('email' in cleared).toBe(false)
  })
})
