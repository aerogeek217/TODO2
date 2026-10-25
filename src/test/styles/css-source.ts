import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** The app's source folder. */
export const SRC = resolve(__dirname, '../..')

export const TOKENS_CSS = readFileSync(join(SRC, 'styles/tokens.css'), 'utf8')

/** Every file under `src/` (tests left out) whose name matches `pattern`, as `[path relative to src, text]`. */
export function sourceFiles(pattern: RegExp): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (path !== join(SRC, 'test')) walk(path)
      } else if (pattern.test(name)) {
        out.push([relative(SRC, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')])
      }
    }
  }
  walk(SRC)
  return out
}

/** The `--name: value;` declarations of the first rule whose selector list starts with `selector`. */
export function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`no ${selector} rule`)
  const open = css.indexOf('{', start)
  const end = css.indexOf('\n}', open)
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '')
  const map = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim())
  return map
}

export type ThemeName = 'dark' | 'light'

const THEME_SELECTORS: Record<ThemeName, string> = { dark: '[data-theme="dark"],', light: '[data-theme="light"] {' }

/** A theme's custom properties: the theme-independent base, then the theme's own block. */
export function themeTokens(theme: ThemeName): Map<string, string> {
  return new Map([...declarations(TOKENS_CSS, ':root {'), ...declarations(TOKENS_CSS, THEME_SELECTORS[theme])])
}

export type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
}

const NAMED: Record<string, Rgb> = { black: [0, 0, 0], white: [255, 255, 255] }

/**
 * A theme token as an opaque sRGB colour: hex values, `var()` references
 * (within the theme) and `color-mix(in srgb, <a> P%, <b>)` — the forms the
 * stylesheet's text and surface colours use.
 */
export function resolveColor(value: string, tokens: Map<string, string>, depth = 0): Rgb {
  if (depth > 10) throw new Error(`token cycle at ${value}`)
  const v = value.trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  if (ref) {
    const next = tokens.get(ref[1]!)
    if (next === undefined) throw new Error(`undefined ${ref[1]}`)
    return resolveColor(next, tokens, depth + 1)
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v)
  if (mix) {
    const a = resolveColor(mix[1]!, tokens, depth + 1)
    const b = resolveColor(mix[3]!, tokens, depth + 1)
    const p = Number(mix[2]) / 100
    return a.map((c, i) => c * p + b[i]! * (1 - p)) as Rgb
  }
  if (v.startsWith('#')) return parseHex(v)
  const named = NAMED[v]
  if (named) return named
  throw new Error(`can't resolve colour ${v}`)
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** The WCAG 2 contrast ratio of two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
