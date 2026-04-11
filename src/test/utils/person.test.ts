import { describe, it, expect } from 'vitest'
import { generateInitials } from '../../utils/person'

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
