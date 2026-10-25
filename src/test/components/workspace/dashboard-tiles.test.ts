import { describe, it, expect } from 'vitest'
import { TILES, tileColors } from '../../../components/workspace/dashboard/dashboard-tiles'
import { DASHBOARD_TILE_IDS } from '../../../models/dashboard-config'

const MUTED = 'var(--color-text-muted)'
const TEXT = 'var(--color-text-primary)'

describe('tile colour: lit only when the number asks for action (D18)', () => {
  it('Overdue, Follow-up due, Hot, Urgent and Due today light above 0; the rest never', () => {
    const lit = DASHBOARD_TILE_IDS.filter((id) => TILES[id].litWhen(1))
    expect(lit.sort()).toEqual(['dueToday', 'followupDue', 'hot', 'overdue', 'urgent'])
    for (const id of DASHBOARD_TILE_IDS) expect(TILES[id].litWhen(0)).toBe(false)
    expect(TILES.open.litWhen(500)).toBe(false)
  })

  it('lit: label, glyph and count in the tile’s colour', () => {
    expect(tileColors('overdue', 3)).toEqual({ lit: true, label: 'var(--color-overdue)', glyph: 'var(--color-overdue)', count: 'var(--color-overdue)' })
    expect(tileColors('hot', 1).count).toBe('var(--color-danger)')
  })

  it('neutral: label and glyph muted, the count in the text colour, a 0 muted', () => {
    expect(tileColors('open', 109)).toEqual({ lit: false, label: MUTED, glyph: MUTED, count: TEXT })
    expect(tileColors('focus', 6).count).toBe(TEXT)
    expect(tileColors('overdue', 0)).toEqual({ lit: false, label: MUTED, glyph: MUTED, count: MUTED })
    expect(tileColors('open', 0).count).toBe(MUTED)
  })
})
