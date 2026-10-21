import { describe, it, expect } from 'vitest'
import { TOKENS_CSS, sourceFiles } from './css-source'

const sources = sourceFiles(/\.(css|ts|tsx)$/)
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** Custom properties a stylesheet or a component defines (`--x: …`, an inline style's `'--x'` key). */
function definedProperties(): Set<string> {
  const out = new Set<string>()
  for (const [, text] of sources) {
    for (const m of stripComments(text).matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]!)
    for (const m of text.matchAll(/['"`](--[\w-]+)['"`]/g)) out.add(m[1]!)
  }
  return out
}

/** Custom properties read anywhere: `var(--x)` in CSS or an inline style, or a property name looked up in code. */
function readProperties(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (name: string, path: string) => out.set(name, [...(out.get(name) ?? []), path])
  for (const [path, text] of sources) {
    for (const m of stripComments(text).matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      // A `var(--x, fallback)` stands without a definition.
      if (m[2] === ')') add(m[1]!, path)
    }
    if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      for (const m of text.matchAll(/['"`](--[\w-]+)['"`]/g)) add(m[1]!, path)
    }
  }
  return out
}

describe('design tokens', () => {
  it('every token tokens.css defines is used somewhere', () => {
    const tokens = [...new Set([...stripComments(TOKENS_CSS).matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!))]
    const read = readProperties()
    // tokens.css reading its own tokens counts (an alias, a shadow made of a ring).
    expect(tokens.filter((t) => !read.has(t))).toEqual([])
  })

  it('every custom property read without a fallback is defined', () => {
    const defined = definedProperties()
    const undefinedReads = [...readProperties()]
      .filter(([name]) => !defined.has(name))
      .map(([name, paths]) => `${name} (${[...new Set(paths)].join(', ')})`)
    expect(undefinedReads).toEqual([])
  })
})
