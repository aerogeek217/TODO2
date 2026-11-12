import { describe, it, expect } from 'vitest'
import { generateInitials, normalizeInitials } from '../../utils/person'

describe('normalizeInitials', () => {
  it('trims, uppercases and keeps at most 3 characters', () => {
    expect(normalizeInitials(' ab ', 'Ann Bee')).toBe('AB')
    expect(normalizeInitials('abcd', 'Ann Bee')).toBe('ABC')
    expect(normalizeInitials('FIN', 'Finance')).toBe('FIN')
  })

  it('nothing left → made from the name', () => {
    expect(normalizeInitials('   ', 'Ann Bee')).toBe('AB')
  })
})

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
