import { describe, it, expect } from 'vitest'
import { replaceMarkdownLinks } from '../../utils/markdown-links'

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const LINK_EMPTY = /\[([^\]]*)\]\(([^)]*)\)/g
const mark = (text: string, href: string) => `<${text}|${href}>`

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    return x / 0x80000000
  }
}

describe('replaceMarkdownLinks', () => {
  it('replaces links left to right', () => {
    expect(replaceMarkdownLinks('a [x](u) b [y](v)', mark)).toBe('a <x|u> b <y|v>')
  })

  it('leaves text without links untouched', () => {
    expect(replaceMarkdownLinks('a [b] (c) [d](', mark)).toBe('a [b] (c) [d](')
  })

  it('needs non-empty text and href unless allowEmpty', () => {
    expect(replaceMarkdownLinks('[](u) [x]()', mark)).toBe('[](u) [x]()')
    expect(replaceMarkdownLinks('[](u) [x]()', mark, true)).toBe('<|u> <x|>')
  })

  it('matches the equivalent regex on random strings', () => {
    const next = rng(42)
    const alphabet = '[]()ab'
    for (let n = 0; n < 5000; n++) {
      const len = Math.floor(next() * 24)
      let s = ''
      for (let i = 0; i < len; i++) s += alphabet[Math.floor(next() * alphabet.length)]
      expect(replaceMarkdownLinks(s, mark), s).toBe(s.replace(LINK, (_m, t: string, h: string) => mark(t, h)))
      expect(replaceMarkdownLinks(s, mark, true), s).toBe(s.replace(LINK_EMPTY, (_m, t: string, h: string) => mark(t, h)))
    }
  })

  it('stays linear on runs of `[` and of `[a](` without a `)`', () => {
    const n = 400_000
    const start = performance.now()
    expect(replaceMarkdownLinks('['.repeat(n), mark)).toBe('['.repeat(n))
    expect(replaceMarkdownLinks('[a]('.repeat(n / 4), mark, true)).toBe('[a]('.repeat(n / 4))
    // The regex takes minutes on these; a linear scan takes milliseconds.
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
