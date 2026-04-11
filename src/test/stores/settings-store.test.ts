import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettingsStore.setState({
    colors: {
      accent: '#a2cfcb',
      canvasBg: '#0e0e0e',
      surface: '#191a1a',
      priorityHigh: '#ee7d77',
      priorityMedium: '#f5a623',
      star: '#f5c842',
    },
    defaultProjectId: null,
    completedRetentionDays: null,
  })
})

describe('useSettingsStore', () => {
  it('load loads colors from DB and falls back to defaults', async () => {
    await db.settings.put({ key: 'color.accent', value: '#ff0000' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.accent).toBe('#ff0000')
    // Other colors should be defaults
    expect(useSettingsStore.getState().colors.canvasBg).toBe('#0e0e0e')
  })

  it('load ignores invalid colors', async () => {
    await db.settings.put({ key: 'color.accent', value: 'not-a-color' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.accent).toBe('#a2cfcb') // default
  })

  it('setColor persists valid color', async () => {
    await useSettingsStore.getState().setColor('accent', '#00ff00')
    expect(useSettingsStore.getState().colors.accent).toBe('#00ff00')
    // Persisted to DB
    const rows = await db.settings.get('color.accent')
    expect(rows!.value).toBe('#00ff00')
  })

  it('setColor rejects invalid', async () => {
    await useSettingsStore.getState().setColor('accent', 'not-valid')
    expect(useSettingsStore.getState().colors.accent).toBe('#a2cfcb') // unchanged
  })

  it('resetColors restores defaults', async () => {
    await useSettingsStore.getState().setColor('accent', '#ff0000')
    await useSettingsStore.getState().resetColors()
    expect(useSettingsStore.getState().colors.accent).toBe('#a2cfcb')
  })

  it('setDefaultProjectId persists and clears', async () => {
    await useSettingsStore.getState().setDefaultProjectId(42)
    expect(useSettingsStore.getState().defaultProjectId).toBe(42)

    await useSettingsStore.getState().setDefaultProjectId(null)
    expect(useSettingsStore.getState().defaultProjectId).toBeNull()
  })

  it('setCompletedRetentionDays validates range', async () => {
    await useSettingsStore.getState().setCompletedRetentionDays(30)
    expect(useSettingsStore.getState().completedRetentionDays).toBe(30)

    // Invalid: too large
    await useSettingsStore.getState().setCompletedRetentionDays(9999)
    expect(useSettingsStore.getState().completedRetentionDays).toBe(30) // unchanged

    // Invalid: zero
    await useSettingsStore.getState().setCompletedRetentionDays(0)
    expect(useSettingsStore.getState().completedRetentionDays).toBe(30) // unchanged

    // Clear
    await useSettingsStore.getState().setCompletedRetentionDays(null)
    expect(useSettingsStore.getState().completedRetentionDays).toBeNull()
  })

  it('load loads defaultProjectId from DB', async () => {
    await db.settings.put({ key: 'defaultProjectId', value: '10' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().defaultProjectId).toBe(10)
  })
})
