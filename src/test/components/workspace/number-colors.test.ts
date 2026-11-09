import { describe, it, expect } from 'vitest'
import { numberColors } from '../../../components/workspace/glance/number-colors'
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

  it('lit: label and count in its colour — Auto’s the accent', () => {
    expect(numberColors({ color: '#e86bf0', litWhen: 'above', litAt: 0 }, 3)).toEqual({ lit: true, label: '#e86bf0', count: '#e86bf0' })
    expect(numberColors({ litWhen: 'below', litAt: 10 }, 3)).toEqual({ lit: true, label: 'var(--color-accent)', count: 'var(--color-accent)' })
  })

  it('neutral: the label muted, the count in the text colour, a 0 muted', () => {
    expect(numberColors({ litWhen: 'never' }, 109)).toEqual({ lit: false, label: MUTED, count: TEXT })
    expect(numberColors({ color: '#e86bf0', litWhen: 'above', litAt: 0 }, 0)).toEqual({ lit: false, label: MUTED, count: MUTED })
  })
})
