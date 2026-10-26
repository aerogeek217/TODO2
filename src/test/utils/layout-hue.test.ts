import { describe, it, expect } from 'vitest'
import { HUE_NAMES, isHueName, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { HUE_PRESET_HEX, hueAttr, hueColor, isLayoutHue, presetHueOf } from '../../utils/layout-hue'
import { setLayoutHue } from '../../utils/workspace-layout-ops'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'
import { declarations, TOKENS_CSS } from '../styles/css-source'

const layout: PersistedWorkspaceLayout = { id: 1, name: 'D', sortOrder: 0, columns: [], createdAt: new Date(0), modifiedAt: new Date(0) }
const DATE = '2026-09-01T09:00:00.000Z'
const row = (extra: Record<string, unknown>) => ({ id: 1, name: 'Daily', sortOrder: 0, columns: [], createdAt: DATE, modifiedAt: DATE, ...extra })

describe('a layout’s hue (D19)', () => {
  it('six preset names; a hue is a preset or a hex colour', () => {
    expect(HUE_NAMES).toEqual(['teal', 'violet', 'blue', 'green', 'amber', 'rose'])
    expect(isHueName('violet')).toBe(true)
    expect(isHueName('mauve')).toBe(false)
    expect(isHueName(3)).toBe(false)
    expect(isLayoutHue('violet')).toBe(true)
    expect(isLayoutHue('#ff6600')).toBe(true)
    expect(isLayoutHue('#ABC')).toBe(true)
    expect(isLayoutHue('mauve')).toBe(false)
    expect(isLayoutHue('#12')).toBe(false)
    expect(isLayoutHue('red')).toBe(false)
    expect(isLayoutHue(3)).toBe(false)
  })

  it('its colour is the preset’s token or the custom colour itself; none is the app accent', () => {
    expect(hueColor('rose')).toBe('var(--hue-rose)')
    expect(hueColor('#FF6600')).toBe('#ff6600')
    expect(hueColor(undefined)).toBe('var(--color-accent)')
    expect(hueColor(null)).toBe('var(--color-accent)')
    expect(hueAttr('rose')).toBe('rose')
    expect(hueAttr('#ff6600')).toBe('custom')
    expect(hueAttr(undefined)).toBe('none')
  })

  it('the preset colours every picker inserts are the dark-theme hue tokens; a colour maps back to its preset', () => {
    const dark = declarations(TOKENS_CSS, '[data-theme="dark"],')
    for (const name of HUE_NAMES) expect(dark.get(`--hue-${name}`), name).toBe(HUE_PRESET_HEX[name])
    expect(presetHueOf('#A78BFA')).toBe('violet')
    expect(presetHueOf('#123456')).toBeNull()
    expect(presetHueOf(undefined)).toBeNull()
  })

  it('set, cleared (the key goes), the same layout when unchanged', () => {
    const hued = setLayoutHue(layout, 'green')
    expect(hued.hue).toBe('green')
    expect(setLayoutHue(hued, 'green')).toBe(hued)
    expect(setLayoutHue(hued, '#ff6600').hue).toBe('#ff6600')
    expect('hue' in setLayoutHue(hued, null)).toBe(false)
    expect(setLayoutHue(layout, null)).toBe(layout)
  })

  it('a stored or imported layout keeps a preset or a hex colour; anything else is reset with a fix', () => {
    expect(validateRow('layouts', row({ hue: 'teal' }))).toBe(true)
    expect(sanitizeRow('layouts', row({ hue: 'teal' }))).toMatchObject({ hue: 'teal' })
    expect(validateRow('layouts', row({ hue: '#ff6600' }))).toBe(true)
    expect(sanitizeRow('layouts', row({ hue: '#ff6600' }))).toMatchObject({ hue: '#ff6600' })
    expect(validateRow('layouts', row({ hue: 'mauve' }))).toBe('hue')
    expect(rowFixes('layouts', row({ hue: 'mauve' }))).toEqual(['hue reset'])
    expect(sanitizeRow('layouts', row({ hue: 'mauve' })).hue).toBeUndefined()
    expect(sanitizeRow('layouts', row({})).hue).toBeUndefined()
  })
})
