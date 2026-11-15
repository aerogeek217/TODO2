import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRIORITY_TINT_VARS, THEME_COLOR_VARS } from '../../models/theme-colors'
import { SRC, themeTokens } from './css-source'

/**
 * cr34 U5 · the task layout's priority toggles (the editor's and the review
 * card's Focus / Urgent / Important): pressed, each is the priority's own
 * color on the priority's own tint — the marker tokens, which a priority
 * given its own color in Settings › Theme colors sets (`settings-store`'s
 * `applyColorOverrides`) — never the accent's, Danger's or Follow up's tint
 * under another color's text.
 */

const CSS = readFileSync(join(SRC, 'components/task/TaskDetails.module.css'), 'utf8')

/** The declarations of the pressed toggle's rule for `marker`. */
function pressedRule(marker: string): Map<string, string> {
  const selector = `.markerToggle[data-marker='${marker}'][aria-pressed='true'] {`
  const start = CSS.indexOf(selector)
  if (start < 0) throw new Error(`no pressed rule for ${marker}`)
  const body = CSS.slice(start + selector.length, CSS.indexOf('}', start))
  return new Map([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]))
}

const DEFAULT_TINT = { focus: '--color-accent-bg-medium', urgent: '--color-danger-bg', important: '--color-followup-bg' } as const

describe('the pressed priority toggles draw from the marker tokens', () => {
  it.each(['focus', 'urgent', 'important'] as const)('%s: its own color on its own tint', (marker) => {
    const rule = pressedRule(marker)
    expect(rule.get('color')).toBe(`var(${THEME_COLOR_VARS[marker]})`)
    // The token a priority's own color sets.
    expect(rule.get('background')).toBe(`var(${PRIORITY_TINT_VARS[marker]!.fill})`)
  })

  it.each(['dark', 'light'] as const)('%s: with no color of its own, each tint is the one it was', (theme) => {
    const tokens = themeTokens(theme)
    for (const marker of ['focus', 'urgent', 'important'] as const) {
      expect(tokens.get(PRIORITY_TINT_VARS[marker]!.fill), marker).toBe(`var(${DEFAULT_TINT[marker]})`)
    }
  })
})
