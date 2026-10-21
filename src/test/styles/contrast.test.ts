import { describe, it, expect } from 'vitest'
import { contrast, resolveColor, sourceFiles, themeTokens, type ThemeName } from './css-source'

/** WCAG AA for normal-size text. */
const AA_TEXT = 4.5
/** WCAG AA for graphics (a checkmark, a knob) and large text. */
const AA_GRAPHIC = 3

function ratio(theme: ThemeName, fg: string, bg: string): number {
  const tokens = themeTokens(theme)
  const value = (name: string) => {
    const v = tokens.get(name)
    if (v === undefined) throw new Error(`${theme}: no ${name}`)
    return v
  }
  return contrast(resolveColor(value(fg), tokens), resolveColor(value(bg), tokens))
}

const THEMES: ThemeName[] = ['dark', 'light']

describe('text contrast (WCAG AA)', () => {
  it.each(THEMES)('%s: muted text reads on every surface it sits on', (theme) => {
    for (const bg of ['--color-surface', '--color-surface-high', '--color-app-bg', '--color-header-bg']) {
      expect(ratio(theme, '--color-text-muted', bg), `${theme} muted on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it.each(THEMES)('%s: the accent as text reads on the surfaces', (theme) => {
    for (const bg of ['--color-surface', '--color-surface-high', '--color-app-bg']) {
      expect(ratio(theme, '--color-accent-text', bg), `${theme} accent text on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('the light accent as text follows an accent colour override', () => {
    // Mixed from the accent, so `color.light.accent` (an inline --color-accent) carries over.
    expect(themeTokens('light').get('--color-accent-text')).toMatch(/var\(--color-accent\)/)
    expect(themeTokens('dark').get('--color-accent-text')).toBe('var(--color-accent)')
  })

  it.each(THEMES)('%s: a checkmark on the accent fill stands out', (theme) => {
    expect(ratio(theme, '--color-text-on-accent', '--color-accent')).toBeGreaterThanOrEqual(AA_GRAPHIC)
  })

  it('dark: a danger button’s label reads on its fill', () => {
    expect(ratio('dark', '--color-surface', '--color-danger')).toBeGreaterThanOrEqual(AA_TEXT)
  })
})

/** Literal white is theme-blind: on the dark theme's light accent or danger fills it all but vanishes. */
describe('no hard-coded white in component styles', () => {
  // The check-in email preview is an email: white paper in either theme.
  const ALLOWED = new Set(['components/checkin/CheckinDialog.module.css'])

  it('every white comes from a token', () => {
    const offenders = sourceFiles(/\.module\.css$/)
      .filter(([path]) => !ALLOWED.has(path))
      .flatMap(([path, css]) => css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => /:\s*[^;]*(#fff\b|#ffffff\b|\bwhite\b)/i.test(line) && !/white-space/.test(line))
        .map((line) => `${path}: ${line.trim()}`))
    expect(offenders).toEqual([])
  })
})
