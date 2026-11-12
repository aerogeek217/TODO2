import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_THEMED_COLORS,
  THEME_COLOR_FOLLOWS,
  THEME_COLOR_VARS,
  parseColorSettingKey,
  themeColorShown,
  type ThemeColors,
  type ThemeName,
} from '../../models/theme-colors'

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
const NAMES = Object.keys(THEME_COLOR_VARS) as (keyof ThemeColors)[]

describe('theme colour seeds', () => {
  it.each(['dark', 'light'] as const)('the %s seeds are the stylesheet values the overrides replace', (theme) => {
    const tokens = declarations(css, THEME_RULES[theme])
    // A colour that follows another is that one's `var()` in the stylesheet, and its seed that one's seed.
    const own = NAMES.filter((name) => THEME_COLOR_FOLLOWS[name] === undefined)
    const expected = Object.fromEntries(own.map((name) => [name, tokens.get(THEME_COLOR_VARS[name])]))
    for (const name of NAMES) {
      const follows = THEME_COLOR_FOLLOWS[name]
      if (follows === undefined) continue
      expect(tokens.get(THEME_COLOR_VARS[name]), name).toBe(`var(${THEME_COLOR_VARS[follows]})`)
      expected[name] = expected[follows]
    }
    expect(DEFAULT_THEMED_COLORS[theme] satisfies ThemeColors).toEqual(expected)
  })

  it('a colour follows only a colour with a value of its own', () => {
    for (const follows of Object.values(THEME_COLOR_FOLLOWS)) expect(THEME_COLOR_FOLLOWS[follows]).toBeUndefined()
  })
})

describe('themeColorShown', () => {
  const colors: ThemeColors = { ...DEFAULT_THEMED_COLORS.dark, danger: '#ff0000', urgent: '#00ff00' }

  it('a priority with no override shows the colour it follows, that one’s override included', () => {
    expect(themeColorShown(colors, ['danger'], 'urgent')).toBe('#ff0000')
    expect(themeColorShown(DEFAULT_THEMED_COLORS.light, [], 'important')).toBe(DEFAULT_THEMED_COLORS.light.star)
    expect(themeColorShown(DEFAULT_THEMED_COLORS.light, [], 'focus')).toBe(DEFAULT_THEMED_COLORS.light.accent)
  })

  it('a priority with an override shows its own', () => {
    expect(themeColorShown(colors, ['danger', 'urgent'], 'urgent')).toBe('#00ff00')
  })

  it('any other colour shows its own value', () => {
    expect(themeColorShown(colors, ['danger'], 'danger')).toBe('#ff0000')
    expect(themeColorShown(colors, [], 'accent')).toBe(DEFAULT_THEMED_COLORS.dark.accent)
  })
})

describe('parseColorSettingKey', () => {
  it('reads the priorities’ keys', () => {
    expect(parseColorSettingKey('color.dark.urgent')).toEqual({ theme: 'dark', name: 'urgent' })
    expect(parseColorSettingKey('color.light.important')).toEqual({ theme: 'light', name: 'important' })
    expect(parseColorSettingKey('color.light.focus')).toEqual({ theme: 'light', name: 'focus' })
  })
})
