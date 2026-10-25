import { describe, it, expect } from 'vitest'
import { HUE_NAMES, isHueName, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { hueColor } from '../../utils/layout-hue'
import { setLayoutHue } from '../../utils/workspace-layout-ops'
import { rowFixes, sanitizeRow, validateRow } from '../../data/import-validation'

const layout: PersistedWorkspaceLayout = { id: 1, name: 'D', sortOrder: 0, columns: [], createdAt: new Date(0), modifiedAt: new Date(0) }
const DATE = '2026-09-01T09:00:00.000Z'
const row = (extra: Record<string, unknown>) => ({ id: 1, name: 'Daily', sortOrder: 0, columns: [], createdAt: DATE, modifiedAt: DATE, ...extra })

describe('a layout’s hue (D19)', () => {
  it('six names; anything else is not a hue', () => {
    expect(HUE_NAMES).toEqual(['teal', 'violet', 'blue', 'green', 'amber', 'rose'])
    expect(isHueName('violet')).toBe(true)
    expect(isHueName('mauve')).toBe(false)
    expect(isHueName(3)).toBe(false)
  })

  it('its colour is the hue’s token; none is the app accent', () => {
    expect(hueColor('rose')).toBe('var(--hue-rose)')
    expect(hueColor(undefined)).toBe('var(--color-accent)')
    expect(hueColor(null)).toBe('var(--color-accent)')
  })

  it('set, cleared (the key goes), the same layout when unchanged', () => {
    const hued = setLayoutHue(layout, 'green')
    expect(hued.hue).toBe('green')
    expect(setLayoutHue(hued, 'green')).toBe(hued)
    expect('hue' in setLayoutHue(hued, null)).toBe(false)
    expect(setLayoutHue(layout, null)).toBe(layout)
  })

  it('a stored or imported layout keeps a known hue; an unknown one is reset with a fix', () => {
    expect(validateRow('layouts', row({ hue: 'teal' }))).toBe(true)
    expect(sanitizeRow('layouts', row({ hue: 'teal' }))).toMatchObject({ hue: 'teal' })
    expect(validateRow('layouts', row({ hue: 'mauve' }))).toBe('hue')
    expect(rowFixes('layouts', row({ hue: 'mauve' }))).toEqual(['hue reset'])
    expect(sanitizeRow('layouts', row({ hue: 'mauve' })).hue).toBeUndefined()
    expect(sanitizeRow('layouts', row({})).hue).toBeUndefined()
  })
})
