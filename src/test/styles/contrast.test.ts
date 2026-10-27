import { describe, it, expect } from 'vitest'
import { DEFAULT_THEMED_COLORS } from '../../models/theme-colors'
import { contrast, resolveColor, sourceFiles, themeTokens, type Rgb, type ThemeName } from './css-source'

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
    for (const bg of ['--color-surface', '--color-surface-high', '--color-app-bg', '--color-header-bg', '--color-dialog-bg']) {
      expect(ratio(theme, '--color-text-muted', bg), `${theme} muted on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it.each(THEMES)('%s: a popover’s text reads on both levels (D21; muted text there is the popover muted)', (theme) => {
    for (const bg of ['--color-popover-bg', '--color-popover-bg-2']) {
      for (const fg of ['--color-text-primary', '--color-text-secondary', '--color-popover-text-muted', '--color-accent-text', '--color-overdue', '--color-deadline', '--color-danger-text']) {
        expect(ratio(theme, fg, bg), `${theme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
      }
    }
  })

  it.each(THEMES)('%s: the accent as text reads on the surfaces', (theme) => {
    for (const bg of ['--color-surface', '--color-surface-high', '--color-app-bg', '--color-popover-bg']) {
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

describe('the warm light theme (D19) keeps D0’s contrast', () => {
  const SURFACES = ['--color-surface', '--color-surface-high', '--color-app-bg', '--color-header-bg', '--color-popover-bg', '--color-dialog-bg']

  it.each(['--color-text-primary', '--color-text-secondary', '--color-text-muted', '--color-accent-text'])('light: %s reads on every surface', (fg) => {
    for (const bg of SURFACES) {
      expect(ratio('light', fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it.each(THEMES)('%s: muted tab labels read at the foot of the cell header’s gradient', (theme) => {
    expect(ratio(theme, '--color-text-muted', '--cell-header-shade')).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(THEMES)('%s: the focus ring’s accent stands out from every surface', (theme) => {
    for (const bg of SURFACES) {
      expect(ratio(theme, '--color-accent', bg), `accent on ${bg}`).toBeGreaterThanOrEqual(AA_GRAPHIC)
    }
  })
})

describe('overdue / deadline text reads wherever it sits', () => {
  // The surfaces, the cell header's foot, and what a hovered row lies on.
  const UNDER = ['--color-surface', '--color-surface-high', '--color-app-bg', '--color-header-bg', '--color-popover-bg', '--cell-header-shade']

  it.each(THEMES)('%s: --color-overdue and --color-deadline at 4.5:1', (theme) => {
    for (const fg of ['--color-overdue', '--color-deadline']) {
      for (const bg of UNDER) {
        expect(ratio(theme, fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
      }
    }
  })

  it('light: on a hovered row (5% black over the surface) and on its own tint over surface-high', () => {
    const tokens = themeTokens('light')
    const at = (name: string) => resolveColor(tokens.get(name)!, tokens)
    const over = (fg: Rgb, p: number, bg: Rgb) => bg.map((c, i) => fg[i]! * p + c * (1 - p)) as Rgb
    const overdue = at('--color-overdue')
    for (const surface of ['--color-surface', '--color-surface-high']) {
      expect(contrast(overdue, over([0, 0, 0], 0.05, at(surface))), `hovered on ${surface}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
    expect(contrast(overdue, over([184, 56, 192], 0.08, at('--color-surface-high'))), 'on --color-overdue-bg').toBeGreaterThanOrEqual(AA_TEXT)
  })

  it('the editable deadline default is the stylesheet’s', () => {
    expect(DEFAULT_THEMED_COLORS.light.deadline).toBe(themeTokens('light').get('--color-deadline'))
    expect(DEFAULT_THEMED_COLORS.dark.deadline).toBe(themeTokens('dark').get('--color-deadline'))
  })
})

describe('the layout hues (D19) stand out like the accent', () => {
  it.each(THEMES)('%s: each hue at 3:1 on every surface (the tab underline, the focus ring)', (theme) => {
    for (const hue of ['teal', 'violet', 'blue', 'green', 'amber', 'rose']) {
      for (const bg of ['--color-surface', '--color-surface-high', '--color-app-bg', '--color-header-bg']) {
        expect(ratio(theme, `--hue-${hue}`, bg), `${hue} on ${bg}`).toBeGreaterThanOrEqual(AA_GRAPHIC)
      }
    }
  })
})

describe('the calendar heat map (D18) reads on every step', () => {
  const STEPS = (hue: 'due' | 'followup') => [1, 2, 3].map((n) => `--cal-heat-${hue}-${n}`)

  it.each(THEMES)('%s: a late day’s number', (theme) => {
    for (const hue of ['due', 'followup'] as const) {
      for (const bg of ['--color-surface', ...STEPS(hue)]) {
        expect(ratio(theme, `--cal-late-${hue}`, bg), `late ${hue} on ${bg}`).toBeGreaterThanOrEqual(AA_TEXT)
      }
    }
  })

  it.each(THEMES)('%s: a day’s count (secondary on step 1, primary on 2–3)', (theme) => {
    for (const hue of ['due', 'followup'] as const) {
      const [one, two, three] = STEPS(hue) as [string, string, string]
      expect(ratio(theme, '--color-text-secondary', one), `count on ${one}`).toBeGreaterThanOrEqual(AA_TEXT)
      expect(ratio(theme, '--color-text-primary', two), `count on ${two}`).toBeGreaterThanOrEqual(AA_TEXT)
      expect(ratio(theme, '--color-text-primary', three), `count on ${three}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
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

/** A custom accent (Settings › Appearance, an inline --color-accent) must tint with its own colour. */
describe('the accent tints follow the accent', () => {
  it.each(THEMES)('%s: every --color-accent-* alpha tint is mixed from --color-accent', (theme) => {
    const tokens = themeTokens(theme)
    const tints = [...tokens.entries()].filter(([name]) => /^--color-accent-(bg|glow|focus|shadow)/.test(name))
    expect(tints.length).toBeGreaterThanOrEqual(8)
    for (const [name, value] of tints) {
      expect(value, name).toMatch(/^color-mix\(in srgb, var\(--color-accent\) [\d.]+%, transparent\)$/)
    }
  })
})
