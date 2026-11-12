import { describe, it, expect } from 'vitest'
import { dimmed, litColors, numberColors } from '../../../components/workspace/glance/number-colors'
import { numberIsLit } from '../../../models/glance-widgets'

const MUTED = 'var(--color-text-muted)'
const TEXT = 'var(--color-text-primary)'

describe('a Number’s colour: lit only when its count crosses its threshold (D18)', () => {
  it('never, above N, below N', () => {
    expect(numberIsLit({ litWhen: 'never' }, 500)).toBe(false)
    expect([0, 1].map((n) => numberIsLit({ litWhen: 'above', litAt: 0 }, n))).toEqual([false, true])
    expect([5, 6].map((n) => numberIsLit({ litWhen: 'above', litAt: 5 }, n))).toEqual([false, true])
    expect([2, 3].map((n) => numberIsLit({ litWhen: 'below', litAt: 3 }, n))).toEqual([true, false])
    // A threshold left out reads as 0.
    expect(numberIsLit({ litWhen: 'above' }, 1)).toBe(true)
  })

  it('lit: label and count in its colour as the theme draws it (J21) — Auto’s the accent', () => {
    // v78's overdue hex → the overdue token; a preset → its text token; any other hex shaded by the theme's token.
    // The line takes it too (widget feedback 2D).
    expect(numberColors({ color: '#e86bf0', litWhen: 'above', litAt: 0 }, 3)).toEqual({ lit: true, label: 'var(--color-overdue)', count: 'var(--color-overdue)', line: 'var(--color-overdue)' })
    expect(numberColors({ color: '#A78BFA', litWhen: 'above', litAt: 0 }, 3).count).toBe('var(--hue-violet-text)')
    expect(numberColors({ color: '#123456', litWhen: 'above', litAt: 0 }, 3).count).toBe('color-mix(in oklab, #123456, #000 var(--custom-color-shade))')
    expect(numberColors({ litWhen: 'below', litAt: 10 }, 3)).toEqual({ lit: true, label: 'var(--color-accent)', count: 'var(--color-accent)', line: 'var(--color-accent)' })
    // Lit, the colour otherwise plays no part.
    expect(numberColors({ unlitColor: '#A78BFA', litWhen: 'below', litAt: 10 }, 3).line).toBe('var(--color-accent)')
  })

  it('not lit on Auto, as before: the label muted, the count in the text colour, a 0 muted, the line in the accent', () => {
    expect(numberColors({ litWhen: 'never' }, 109)).toEqual({ lit: false, label: MUTED, count: TEXT, line: 'var(--color-accent)' })
    expect(numberColors({ color: '#e86bf0', litWhen: 'above', litAt: 0 }, 0)).toEqual({ lit: false, label: MUTED, count: MUTED, line: 'var(--color-accent)' })
  })

  it('not lit with a colour otherwise (widget feedback 2D): label, count and line in it as the theme draws it; a 0 dimmed', () => {
    const violet = 'var(--hue-violet-text)'
    expect(numberColors({ unlitColor: '#A78BFA', litWhen: 'never' }, 4)).toEqual({ lit: false, label: violet, count: violet, line: violet })
    expect(numberColors({ unlitColor: '#A78BFA', color: '#e86bf0', litWhen: 'above', litAt: 5 }, 0)).toEqual({ lit: false, label: violet, count: dimmed(violet), line: violet })
    expect(dimmed(violet)).toBe('color-mix(in srgb, var(--hue-violet-text) 60%, transparent)')
  })

  it('a shape’s own rule (litColors): lit or not, the same two colours', () => {
    expect(litColors({ color: '#e86bf0', unlitColor: '#A78BFA' }, true).line).toBe('var(--color-overdue)')
    expect(litColors({ color: '#e86bf0', unlitColor: '#A78BFA' }, false).label).toBe('var(--hue-violet-text)')
    expect(litColors({}, false, true)).toEqual({ lit: false, label: MUTED, count: MUTED, line: 'var(--color-accent)' })
  })
})
