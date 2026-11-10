import { describe, it, expect } from 'vitest'
import { configPatch, sameConfigValue } from '../../utils/config-patch'

describe('sameConfigValue', () => {
  it('compares plain data deeply; a key holding undefined reads as absent', () => {
    expect(sameConfigValue({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true)
    expect(sameConfigValue({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(sameConfigValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(sameConfigValue({ a: null }, { a: {} })).toBe(false)
    expect(sameConfigValue({ a: [] }, { a: {} })).toBe(false)
  })
})

describe('configPatch', () => {
  it('holds each top-level key that changed, undefined for one dropped; empty when the same', () => {
    const base = { name: 'A', color: '#fff', filter: { tags: [1] }, litAt: 3 }
    expect(configPatch(base, { ...base, filter: { tags: [1] } })).toEqual({})
    const patch = configPatch<{ name: string; color?: string; filter: { tags: number[] }; litAt?: number; compare?: string }>(
      base,
      { name: 'B', filter: { tags: [1] }, litAt: 3, compare: 'none' },
    )
    expect(patch).toEqual({ name: 'B', color: undefined, compare: 'none' })
    expect(Object.keys(patch).sort()).toEqual(['color', 'compare', 'name'])
  })
})
