import { describe, it, expect } from 'vitest'
import { skyColors, sunColor } from '../../utils/sky'
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

  describe('the ambience takes every colour from tokens.css (cr33 A1)', () => {
    const files = sourceFiles(/\.(tsx?|css)$/)
      .filter(([path]) => path.startsWith('components/ambience/') || path === 'utils/sky.ts' || path === 'utils/sky-events.ts')
    /** A colour written out: hex, a colour function, or a common colour name. */
    const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|yellow|orange|pink|purple|gr[ae]y|silver|gold)\b/i
    const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

    it('no ambience file writes a colour (a mask, whose colour is only its alpha, aside)', () => {
      expect(files.map(([path]) => path)).toEqual(expect.arrayContaining(['utils/sky.ts', 'components/ambience/AmbienceSky.tsx', 'components/ambience/Weather.module.css']))
      const literals = files.flatMap(([path, text]) => code(text)
        .split('\n')
        // A custom property's name (`--ambience-cloud-white`) is no colour.
        .filter((line) => LITERAL.test(line.replace(/--[\w-]+/g, '')) && !/^\s*mask(-image)?:/.test(line))
        .map((line) => `${path}: ${line.trim()}`))
      expect(literals).toEqual([])
    })

    it('no ambience component reads the theme', () => {
      const readers = files
        .filter(([path, text]) => path.startsWith('components/') && /useResolvedTheme|data-theme/.test(code(text)))
        .map(([path]) => path)
      expect(readers).toEqual([])
    })

    it.each(['dark', 'light'] as const)('%s: every --ambience-* token the ambience reads is defined', (theme) => {
      const tokens = themeTokens(theme)
      // Every name written in the files, and every one the sky's and sun's ramps hand out.
      const named = files.flatMap(([, text]) => [...code(text).matchAll(/var\((--ambience-[\w-]*\w)\)/g)].map((m) => m[1] ?? ''))
      const ramps = Array.from({ length: 181 }, (_, i) => i - 90).flatMap((altitude) => {
        const { zenith, horizon } = skyColors(altitude)
        return [zenith, horizon, sunColor(altitude)]
      }).flatMap((colour) => [...colour.matchAll(/var\((--ambience-[\w-]+)\)/g)].map((m) => m[1] ?? ''))
      const read = new Set([...named, ...ramps])
      expect(read.size).toBeGreaterThan(30)
      expect([...read].filter((name) => !tokens.has(name))).toEqual([])
    })
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

  it('inside a popover the focus ring’s gap is the popover’s ground, not the page surface', () => {
    expect(declarations(TOKENS_CSS, '[data-layout-hue] {').get('--focus-ring')).toBe('0 0 0 2px var(--color-surface), 0 0 0 4px var(--focus-ring-color)')
    expect(declarations(TOKENS_CSS, '[data-popover-level] {').get('--focus-ring')).toBe('0 0 0 2px var(--color-popover-bg), 0 0 0 4px var(--focus-ring-color)')
  })

  it('a glass popover root keeps the page surface as the gap (the glass is drawn over it)', () => {
    const files = new Map(sourceFiles(/\.module\.css$/))
    const glassRoots: Array<[string, string]> = [
      // AnchoredPicker's root (its child draws the glass) and every root composing the glass dropdown.
      ['components/shared/AnchoredPicker.module.css', '.picker[data-popover-level] {'],
      ['components/shared/dropdown.module.css', '.menu[data-popover-level] {'],
    ]
    for (const [path, selector] of glassRoots) {
      expect(declarations(files.get(path) ?? '', selector).get('--focus-ring'), `${path} ${selector}`)
        .toBe('0 0 0 2px var(--color-surface), 0 0 0 4px var(--focus-ring-color)')
    }
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
