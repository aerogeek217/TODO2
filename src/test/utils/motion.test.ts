import { describe, it, expect, vi, afterEach } from 'vitest'
import { scrollBehavior } from '../../utils/motion'
import { sourceFiles } from '../styles/css-source'

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('scrollBehavior', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('scrolls smoothly by default', () => {
    stubReducedMotion(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('jumps when the system asks for reduced motion', () => {
    stubReducedMotion(true)
    expect(scrollBehavior()).toBe('auto')
  })
})

describe('transitions name what they animate', () => {
  it('no stylesheet transitions `all` (it would animate layout and colour changes nobody designed)', () => {
    const offenders = sourceFiles(/\.css$/)
      .flatMap(([path, css]) => css.split('\n').filter((l) => /transition:\s*all\b/.test(l)).map((l) => `${path}: ${l.trim()}`))
    expect(offenders).toEqual([])
  })
})
