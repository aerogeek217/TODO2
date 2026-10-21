import { describe, it, expect } from 'vitest'
import { sourceFiles, themeTokens } from './css-source'

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

  it('popovers sit on the raised surface in the dark theme and on the surface in the light one', () => {
    expect(themeTokens('dark').get('--color-popover-bg')).toBe('var(--color-surface-high)')
    expect(themeTokens('light').get('--color-popover-bg')).toBe('var(--color-surface)')
  })

  it('every popover-like panel takes the popover token, never the raised surface straight', () => {
    // The panels a light-theme fork used to put on the surface.
    const panels: Array<[string, string]> = [
      ['components/shared/MenuPopover.module.css', '.menu'],
      ['components/layout/StoragePill.module.css', '.popover'],
      ['components/settings/SettingsModal.module.css', '.dialog'],
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
})
