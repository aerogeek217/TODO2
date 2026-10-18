import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_THEMED_COLORS, THEME_COLOR_VARS, type ThemeColors, type ThemeName } from '../../models/theme-colors'

/** The `--name: value;` declarations of the first rule whose selector list starts with `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector}`)
  if (start < 0) throw new Error(`no ${selector} rule`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out.set(m[1]!, m[2]!.trim())
  return out
}

const css = readFileSync(resolve(__dirname, '../../styles/tokens.css'), 'utf8')
const THEME_RULES: Record<ThemeName, string> = { dark: '[data-theme="dark"],', light: '[data-theme="light"] {' }

describe('theme colour seeds', () => {
  it.each(['dark', 'light'] as const)('the %s seeds are the stylesheet values the overrides replace', (theme) => {
    const tokens = declarations(css, THEME_RULES[theme])
    const expected = Object.fromEntries(Object.entries(THEME_COLOR_VARS).map(([name, cssVar]) => [name, tokens.get(cssVar)]))
    expect(DEFAULT_THEMED_COLORS[theme] satisfies ThemeColors).toEqual(expected)
  })
})
