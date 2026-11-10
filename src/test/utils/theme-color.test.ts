import { describe, expect, it } from 'vitest'
import { HUE_NAMES } from '../../models/workspace-layout'
import { DUE_COLUMN_COLOR, FOLLOWUP_COLUMN_COLOR } from '../../models/chart-widgets'
import { numberConfigOfMetric } from '../../data/upgrades/v78/number-metrics'
import { HUE_PRESET_HEX } from '../../utils/layout-hue'
import { themeColor, UPGRADE_COLOR_TOKENS } from '../../utils/theme-color'
import { themeTokens } from '../styles/css-source'

describe('themeColor (J21)', () => {
  it('a preset hue’s hex → its text token, whatever its case', () => {
    for (const hue of HUE_NAMES) {
      expect(themeColor(HUE_PRESET_HEX[hue])).toBe(`var(--hue-${hue}-text)`)
      expect(themeColor(HUE_PRESET_HEX[hue].toUpperCase())).toBe(`var(--hue-${hue}-text)`)
    }
  })

  it('the four colours v78 wrote → their meanings’ tokens', () => {
    expect(themeColor('#ee7d77')).toBe('var(--color-danger-text)')
    expect(themeColor('#E86BF0')).toBe('var(--color-overdue)')
    expect(themeColor('#f5c842')).toBe('var(--color-followup)')
    expect(themeColor('#8f8a83')).toBe('var(--color-text-muted)')
  })

  it('maps every colour the v78 Number conversion writes, and the default count columns’', () => {
    const written = ['urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup'] as const
    for (const metric of written) {
      const color = numberConfigOfMetric(metric).color
      expect(typeof color, metric).toBe('string')
      expect(UPGRADE_COLOR_TOKENS[color as string], metric).toBeDefined()
    }
    expect(themeColor(DUE_COLUMN_COLOR)).toBe('var(--color-overdue)')
    expect(themeColor(FOLLOWUP_COLUMN_COLOR)).toBe('var(--color-followup)')
  })

  it('any other colour → itself shaded by the theme’s token', () => {
    expect(themeColor('#C6E05A')).toBe('color-mix(in oklab, #c6e05a, #000 var(--custom-color-shade))')
  })

  it('draws in dark exactly what was picked: each token is the hex it maps from there, the shade 0%', () => {
    const dark = themeTokens('dark')
    const resolve = (v: string): string => {
      const m = /^var\((--[\w-]+)\)$/.exec(v)
      return m ? resolve(dark.get(m[1]!)!) : v.toLowerCase()
    }
    for (const hue of HUE_NAMES) expect(resolve(themeColor(HUE_PRESET_HEX[hue]))).toBe(HUE_PRESET_HEX[hue])
    for (const hex of Object.keys(UPGRADE_COLOR_TOKENS)) expect(resolve(themeColor(hex)), hex).toBe(hex)
    expect(dark.get('--custom-color-shade')).toBe('0%')
    expect(themeTokens('light').get('--custom-color-shade')).not.toBe('0%')
  })
})
