import { describe, it, expect } from 'vitest'
import { declarations, sourceFiles, themeTokens, TOKENS_CSS } from './css-source'

/** A selector that forks a rule per theme (`[data-theme="light"] .x`, `:global([data-theme='light']) .x`). */
const THEME_FORK = /\[data-theme\s*=/

describe('theming lives in tokens.css', () => {
  it('no component stylesheet forks a rule per theme', () => {
    const forks = sourceFiles(/\.css$/)
      .filter(([path]) => path !== 'styles/tokens.css')
      .flatMap(([path, css]) => css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => THEME_FORK.test(line))
        .map((line) => `${path}: ${line.trim()}`))
    expect(forks).toEqual([])
  })

  it('popovers sit two tones above the surface in the dark theme and on white in the light one (D21); dialogs keep the raised surface', () => {
    expect(themeTokens('dark').get('--color-popover-bg')).toBe('#2a2825')
    expect(themeTokens('dark').get('--color-popover-bg-2')).toBe('#353230')
    expect(themeTokens('light').get('--color-popover-bg')).toBe('#ffffff')
    expect(themeTokens('light').get('--color-popover-bg-2')).toBe('#ffffff')
    expect(themeTokens('dark').get('--color-dialog-bg')).toBe('var(--color-surface-high)')
    expect(themeTokens('light').get('--color-dialog-bg')).toBe('var(--color-surface)')
  })

  it.each(['dark', 'light'] as const)('%s: every popover token has a level-2 twin; each shadow rings with its own level’s ring', (theme) => {
    const tokens = themeTokens(theme)
    for (const name of ['--color-popover-bg', '--color-popover-ring', '--color-popover-rim', '--shadow-dropdown']) {
      expect(tokens.get(`${name}-2`), `${theme} ${name}-2`).toBeDefined()
    }
    expect(tokens.get('--shadow-dropdown')).toContain('0 0 0 1px var(--color-popover-ring),')
    expect(tokens.get('--shadow-dropdown-2')).toContain('0 0 0 1px var(--color-popover-ring-2),')
  })

  it('the caret’s rim is the dark shadow’s 3px rim (none in light)', () => {
    expect(themeTokens('dark').get('--shadow-dropdown')).toContain(`0 0 0 3px ${themeTokens('dark').get('--color-popover-rim')},`)
    expect(themeTokens('dark').get('--shadow-dropdown-2')).toContain(`0 0 0 3px ${themeTokens('dark').get('--color-popover-rim-2')},`)
    expect(themeTokens('light').get('--color-popover-rim')).toBe('transparent')
  })

  it('level 2 swaps the popover tokens for their twins; every popover takes the popover muted text', () => {
    const level2 = declarations(TOKENS_CSS, "[data-popover-level='2'] {")
    expect(Object.fromEntries(level2)).toEqual({
      '--color-popover-bg': 'var(--color-popover-bg-2)',
      '--color-popover-ring': 'var(--color-popover-ring-2)',
      '--color-popover-rim': 'var(--color-popover-rim-2)',
      '--shadow-dropdown': 'var(--shadow-dropdown-2)',
    })
    expect(declarations(TOKENS_CSS, '[data-popover-level] {').get('--color-text-muted')).toBe('var(--color-popover-text-muted)')
  })

  it('every popover-like panel takes the popover token, never the raised surface straight', () => {
    // The panels a light-theme fork used to put on the surface.
    const panels: Array<[string, string]> = [
      ['components/shared/MenuPopover.module.css', '.menu'],
      ['components/layout/StoragePill.module.css', '.popover'],
      ['components/shared/followup/Followup.module.css', '.popover'],
      ['components/workspace/list/EditList.module.css', '.popover'],
      ['components/workspace/list/ListWidget.module.css', '.bulkBar'],
    ]
    const files = new Map(sourceFiles(/\.module\.css$/))
    for (const [path, selector] of panels) {
      const css = files.get(path) ?? ''
      const start = css.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')} \\{`))
      const rule = css.slice(start, css.indexOf('\n}', start))
      expect(rule, `${path} ${selector}`).toContain('background: var(--color-popover-bg);')
    }
  })

  it('the dialogs keep their own surface, not the popover one', () => {
    const dialogs: Array<[string, string]> = [
      ['components/settings/SettingsModal.module.css', '.dialog'],
      ['components/overlays/TaskDialog.module.css', '.dialog'],
      ['components/checkin/CheckinDialog.module.css', '.dialog'],
    ]
    const files = new Map(sourceFiles(/\.module\.css$/))
    for (const [path, selector] of dialogs) {
      const css = files.get(path) ?? ''
      const start = css.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')} \\{`))
      const rule = css.slice(start, css.indexOf('\n}', start))
      expect(rule, `${path} ${selector}`).toContain('background: var(--color-dialog-bg);')
    }
  })
})
