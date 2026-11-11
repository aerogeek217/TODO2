import { describe, it, expect } from 'vitest'
import { sourceFiles } from './css-source'

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))

/**
 * Font sizes that must stay literal, `file: reason`. Empty on purpose: a size comes from the
 * scale in `tokens.css` (`--font-size-*`), or from a `--font-size-legacy-*` while it waits to be folded onto it.
 */
const ALLOWED_LITERALS: string[] = []

/** `font-size: <value>` and `--…font-size…: <value>` declarations of a stylesheet, as `[line, value]`. */
function fontSizeDeclarations(css: string): Array<[number, string]> {
  const out: Array<[number, string]> = []
  stripComments(css).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w-])(?:--[\w-]*)?font-size\s*:\s*([^;}]+)/g)) out.push([i + 1, m[1]!.trim()])
  })
  return out
}

/** A value that names a token (`var(--font-size-…)`, also as a `var(--x, var(--font-size-…))` fallback), or `inherit` / `0`. */
const fromToken = (value: string) =>
  /^(inherit|0)$/.test(value) || (/^var\(--[\w-]+(,\s*var\(--font-size-[\w-]+\))?\)$/.test(value) && /var\(--font-size-/.test(value))

describe('font sizes come from the scale', () => {
  it('every font-size in component CSS takes a --font-size-* token', () => {
    const bad: string[] = []
    for (const [path, css] of sourceFiles(/\.css$/)) {
      if (path === 'styles/tokens.css') continue
      for (const [line, value] of fontSizeDeclarations(css)) {
        if (!fromToken(value) && !ALLOWED_LITERALS.some((a) => a.startsWith(`${path}:`))) bad.push(`${path}:${line}  ${value}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('no inline fontSize with a literal in TS / TSX', () => {
    const bad: string[] = []
    for (const [path, text] of sourceFiles(/\.tsx?$/)) {
      text.split('\n').forEach((line, i) => {
        if (/\bfontSize\s*:\s*['"`]?\d/.test(line)) bad.push(`${path}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(bad).toEqual([])
  })
})
