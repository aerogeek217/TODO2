import { describe, it, expect } from 'vitest'
import { METRIC_DEFS, numberColors } from '../../../components/workspace/glance/number-defs'
import { METRIC_IDS } from '../../../models/glance-widgets'

const MUTED = 'var(--color-text-muted)'
const TEXT = 'var(--color-text-primary)'

describe('a Number’s colour: lit only when the number asks for action (D18)', () => {
  it('Overdue, Follow-up due, Urgent and Due today light above 0; the rest never', () => {
    const lit = METRIC_IDS.filter((id) => METRIC_DEFS[id].litWhen(1))
    expect(lit.sort()).toEqual(['dueToday', 'followupDue', 'overdue', 'urgent'])
    for (const id of METRIC_IDS) expect(METRIC_DEFS[id].litWhen(0)).toBe(false)
    expect(METRIC_DEFS.open.litWhen(500)).toBe(false)
  })

  it('lit: label, glyph and count in the metric’s colour', () => {
    expect(numberColors('overdue', 3)).toEqual({ lit: true, label: 'var(--color-overdue)', glyph: 'var(--color-overdue)', count: 'var(--color-overdue)' })
  })

  it('neutral: label and glyph muted, the count in the text colour, a 0 muted', () => {
    expect(numberColors('open', 109)).toEqual({ lit: false, label: MUTED, glyph: MUTED, count: TEXT })
    expect(numberColors('focus', 6).count).toBe(TEXT)
    expect(numberColors('overdue', 0)).toEqual({ lit: false, label: MUTED, glyph: MUTED, count: MUTED })
    expect(numberColors('open', 0).count).toBe(MUTED)
  })
})
