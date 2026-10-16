import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'
import { settingsRepository } from '../../data'
import { DEFAULT_THEMED_COLORS } from '../../models/theme-colors'
import type { HotRule } from '../../utils/hot'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettingsStore.setState({
    colors: { dark: { ...DEFAULT_THEMED_COLORS.dark }, light: { ...DEFAULT_THEMED_COLORS.light } },
    themeMode: 'dark',
    completedRetentionDays: null,
  })
})

describe('useSettingsStore', () => {
  it('a failed load still sets the theme on the page (the default mode)', async () => {
    document.documentElement.removeAttribute('data-theme')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'getAll').mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    await useSettingsStore.getState().load()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(error).toHaveBeenCalled()
  })

  it('load reads color.dark.<key> and color.light.<key> rows', async () => {
    await db.settings.put({ key: 'color.dark.accent', value: '#112233' })
    await db.settings.put({ key: 'color.light.appBg', value: '#fafafa' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#112233')
    expect(useSettingsStore.getState().colors.light.appBg).toBe('#fafafa')
  })

  it('load ignores colour rows whose name is not a theme colour (no prototype keys)', async () => {
    await db.settings.put({ key: 'color.dark.constructor', value: '#123456' })
    await db.settings.put({ key: 'color.dark.__proto__', value: '#123456' })
    await db.settings.put({ key: 'color.light.hasOwnProperty', value: '#123456' })
    await useSettingsStore.getState().load()
    const { colors } = useSettingsStore.getState()
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(DEFAULT_THEMED_COLORS.dark).sort())
    expect(Object.hasOwn(colors.dark, 'constructor')).toBe(false)
    expect(typeof colors.light.hasOwnProperty).toBe('function')
  })

  it('load ignores invalid per-theme colors', async () => {
    await db.settings.put({ key: 'color.dark.accent', value: 'not-a-color' })
    await db.settings.put({ key: 'color.light.danger', value: 'still-not' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent) // default
    expect(useSettingsStore.getState().colors.light.danger).toBe('#d94a43') // default
  })

  it('setColor persists per-theme keys', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', '#00ff00')
    await useSettingsStore.getState().setColor('light', 'accent', '#338800')
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#00ff00')
    expect(useSettingsStore.getState().colors.light.accent).toBe('#338800')
    expect((await db.settings.get('color.dark.accent'))!.value).toBe('#00ff00')
    expect((await db.settings.get('color.light.accent'))!.value).toBe('#338800')
  })

  it('setColor: dark write does not leak into light bag', async () => {
    await useSettingsStore.getState().setColor('dark', 'appBg', '#222222')
    expect(useSettingsStore.getState().colors.dark.appBg).toBe('#222222')
    expect(useSettingsStore.getState().colors.light.appBg).toBe('#f5f4f2')
  })

  it('setColor rejects invalid', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', 'not-valid')
    expect(useSettingsStore.getState().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent) // unchanged
  })

  it('resetColors(theme) restores one bag', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
    await useSettingsStore.getState().setColor('light', 'accent', '#0000ff')
    await useSettingsStore.getState().resetColors('dark')
    expect(useSettingsStore.getState().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent)
    expect(useSettingsStore.getState().colors.light.accent).toBe('#0000ff') // untouched
    expect(await db.settings.get('color.dark.accent')).toBeUndefined()
    expect((await db.settings.get('color.light.accent'))!.value).toBe('#0000ff')
  })

  it('resetColors() with no arg restores both bags', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
    await useSettingsStore.getState().setColor('light', 'accent', '#0000ff')
    await useSettingsStore.getState().resetColors()
    expect(useSettingsStore.getState().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent)
    expect(useSettingsStore.getState().colors.light.accent).toBe(DEFAULT_THEMED_COLORS.light.accent)
  })

  it('setThemeMode flips which override bag drives inline styles', async () => {
    // Customize both bags to distinct values, then verify the inline app-bg
    // override flips with the resolved theme.
    await useSettingsStore.getState().setColor('dark', 'appBg', '#aabbcc')
    await useSettingsStore.getState().setColor('light', 'appBg', '#ddeeff')
    await useSettingsStore.getState().setThemeMode('dark')
    expect(document.documentElement.style.getPropertyValue('--color-app-bg')).toBe('#aabbcc')
    await useSettingsStore.getState().setThemeMode('light')
    expect(document.documentElement.style.getPropertyValue('--color-app-bg')).toBe('#ddeeff')
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

  it('followupDefaultInterval defaults to 1 month, persists compactly, and ignores junk on load', async () => {
    useSettingsStore.setState({ followupDefaultInterval: { count: 1, unit: 'm' } })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().followupDefaultInterval).toEqual({ count: 1, unit: 'm' })

    await useSettingsStore.getState().setFollowupDefaultInterval({ count: 2, unit: 'w' })
    expect((await db.settings.get('followupDefaultInterval'))!.value).toBe('2w')
    useSettingsStore.setState({ followupDefaultInterval: { count: 1, unit: 'm' } })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().followupDefaultInterval).toEqual({ count: 2, unit: 'w' })

    await db.settings.put({ key: 'followupDefaultInterval', value: 'soon' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().followupDefaultInterval).toEqual({ count: 1, unit: 'm' })
  })

  it('urgentDueWithinDays defaults to 3 days, persists Off / day counts, and ignores junk on load', async () => {
    useSettingsStore.setState({ urgentDueWithinDays: 3 })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().urgentDueWithinDays).toBe(3)

    await useSettingsStore.getState().setUrgentDueWithinDays(null)
    expect((await db.settings.get('urgentDueWithinDays'))!.value).toBe('off')
    useSettingsStore.setState({ urgentDueWithinDays: 3 })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().urgentDueWithinDays).toBeNull()

    await useSettingsStore.getState().setUrgentDueWithinDays(0)
    expect((await db.settings.get('urgentDueWithinDays'))!.value).toBe('0')
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().urgentDueWithinDays).toBe(0)

    // Out of range: not written.
    await useSettingsStore.getState().setUrgentDueWithinDays(-2)
    expect((await db.settings.get('urgentDueWithinDays'))!.value).toBe('0')

    await db.settings.put({ key: 'urgentDueWithinDays', value: 'soon' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().urgentDueWithinDays).toBe(3)
  })

  it('hotRule defaults to (Urgent AND Important) OR Focus, saves normalized, and ignores junk on load', async () => {
    const DEFAULT: HotRule = [{ urgent: true, important: true }, { focus: true }]
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().hotRule).toEqual(DEFAULT)

    await useSettingsStore.getState().setHotRule([{ focus: true, important: true }, {}, { important: true, focus: true }, { urgent: true }])
    expect((await db.settings.get('hotRule'))!.value).toBe('[{"important":true,"focus":true},{"urgent":true}]')
    expect(useSettingsStore.getState().hotRule).toEqual([{ important: true, focus: true }, { urgent: true }])
    useSettingsStore.setState({ hotRule: DEFAULT })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().hotRule).toEqual([{ important: true, focus: true }, { urgent: true }])

    // No marker at all: not a rule, not written.
    await useSettingsStore.getState().setHotRule([{}])
    await useSettingsStore.getState().setHotRule([])
    expect((await db.settings.get('hotRule'))!.value).toBe('[{"important":true,"focus":true},{"urgent":true}]')

    await db.settings.put({ key: 'hotRule', value: '[{"warm":true}]' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().hotRule).toEqual(DEFAULT)
  })

  it('check-in open method defaults to mailto, saves, and ignores junk on load', async () => {
    useSettingsStore.setState({ checkinOpenMethod: 'eml' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinOpenMethod).toBe('mailto')

    await useSettingsStore.getState().setCheckinOpenMethod('eml')
    expect((await db.settings.get('checkinOpenMethod'))!.value).toBe('eml')
    useSettingsStore.setState({ checkinOpenMethod: 'mailto' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinOpenMethod).toBe('eml')

    await useSettingsStore.getState().setCheckinOpenMethod('outlook' as never)
    expect((await db.settings.get('checkinOpenMethod'))!.value).toBe('eml')

    await db.settings.put({ key: 'checkinOpenMethod', value: 'pigeon' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinOpenMethod).toBe('mailto')
  })

  it('check-in task scope defaults to all, saves each kind, and ignores junk on load', async () => {
    useSettingsStore.setState({ checkinTaskScope: { kind: 'hot' } })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'all' })

    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'list', listDefinitionId: 12 })
    expect((await db.settings.get('checkinTaskScope'))!.value).toBe('list:12')
    useSettingsStore.setState({ checkinTaskScope: { kind: 'all' } })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'list', listDefinitionId: 12 })

    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'due-soon' })
    expect((await db.settings.get('checkinTaskScope'))!.value).toBe('due-soon')

    // Not a scope: not written.
    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'list', listDefinitionId: 0 })
    await useSettingsStore.getState().setCheckinTaskScope({ kind: 'later' } as never)
    expect((await db.settings.get('checkinTaskScope'))!.value).toBe('due-soon')
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'due-soon' })

    await db.settings.put({ key: 'checkinTaskScope', value: 'list:abc' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinTaskScope).toEqual({ kind: 'all' })
  })
})
