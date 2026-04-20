import { describe, it, expect } from 'vitest'
import { resolvePersonColor } from '../../utils/person-color'
import type { Org } from '../../models'

const orgs: Org[] = [
  { id: 1, name: 'Acme', color: '#111111' },
  { id: 2, name: 'Beta', color: '#222222' },
  { id: 3, name: 'Gamma' /* no color */ },
]

describe('resolvePersonColor', () => {
  it('returns undefined when personId is missing', () => {
    expect(resolvePersonColor(undefined, new Map(), orgs)).toBeUndefined()
  })

  it('returns undefined when person has no orgs', () => {
    expect(resolvePersonColor(5, new Map(), orgs)).toBeUndefined()
  })

  it('returns the first assigned org with a color', () => {
    const map = new Map([[5, [1, 2]]])
    expect(resolvePersonColor(5, map, orgs)).toBe('#111111')
  })

  it('skips orgs that lack a color', () => {
    const map = new Map([[5, [3, 2]]])
    expect(resolvePersonColor(5, map, orgs)).toBe('#222222')
  })

  it('returns undefined when no assigned orgs have a color', () => {
    const map = new Map([[5, [3]]])
    expect(resolvePersonColor(5, map, orgs)).toBeUndefined()
  })

  it('returns undefined when the assigned org id is unknown', () => {
    const map = new Map([[5, [99]]])
    expect(resolvePersonColor(5, map, orgs)).toBeUndefined()
  })
})
