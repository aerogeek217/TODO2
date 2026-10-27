import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'
import { emptyPredicate } from '../../models/filter-predicate'
import { settingsRepository } from '../../data'
import { DEFAULT_THEMED_COLORS } from '../../models/theme-colors'
import type { HotRule } from '../../utils/hot'
import { useUndoStore } from '../../stores/undo-store'

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

  it('a failed load says so in the snackbar: the app runs on the defaults', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'getAll').mockRejectedValueOnce(new Error('IndexedDB unavailable'))
    await useSettingsStore.getState().load()
    expect(useUndoStore.getState().snackbar).toEqual({ description: "Couldn't load settings. Reload the page to try again.", notice: true })
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
    expect(useSettingsStore.getState().colors.light.appBg).toBe(DEFAULT_THEMED_COLORS.light.appBg)
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

  it('the check-in filter defaults to none, is kept without people (none = the row removed), and reads leniently', async () => {
    useSettingsStore.setState({ checkinTaskFilter: { ...emptyPredicate(), markers: 'hot' } })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinTaskFilter).toEqual(emptyPredicate())

    await useSettingsStore.getState().setCheckinTaskFilter({ ...emptyPredicate(), showCompleted: true, personIds: [3], negate: { personIds: true, tags: true }, tags: [4] })
    const kept = { ...emptyPredicate(), tags: [4], negate: { tags: true } }
    expect(useSettingsStore.getState().checkinTaskFilter).toEqual(kept)
    expect(JSON.parse((await db.settings.get('checkinTaskFilter'))!.value)).toEqual(kept)
    useSettingsStore.setState({ checkinTaskFilter: emptyPredicate() })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinTaskFilter).toEqual(kept)

    await useSettingsStore.getState().setCheckinTaskFilter(emptyPredicate())
    expect(await db.settings.get('checkinTaskFilter')).toBeUndefined()

    await db.settings.put({ key: 'checkinTaskFilter', value: 'not json' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().checkinTaskFilter).toEqual(emptyPredicate())
  })

  it('new-list sort / direction / grouping: Manual / ascending / none by default, stored only when not, junk ignored on load', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'manual', newListSortDirection: 'asc', newListGroup: 'none' })

    await useSettingsStore.getState().setNewListSort('deadline', 'desc')
    await useSettingsStore.getState().setNewListGroup('tag')
    expect(await db.settings.get('newListSort')).toEqual({ key: 'newListSort', value: 'deadline' })
    expect(await db.settings.get('newListSortDirection')).toEqual({ key: 'newListSortDirection', value: 'desc' })
    expect(await db.settings.get('newListGroup')).toEqual({ key: 'newListGroup', value: 'tag' })
    useSettingsStore.setState({ newListSort: 'manual', newListSortDirection: 'asc', newListGroup: 'none' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'deadline', newListSortDirection: 'desc', newListGroup: 'tag' })

    // A sort without a direction keeps none; the defaults remove the rows.
    await useSettingsStore.getState().setNewListSort('people', 'desc')
    expect(useSettingsStore.getState().newListSortDirection).toBe('asc')
    expect(await db.settings.get('newListSortDirection')).toBeUndefined()
    await useSettingsStore.getState().setNewListSort('manual')
    await useSettingsStore.getState().setNewListGroup('none')
    expect(await db.settings.get('newListSort')).toBeUndefined()
    expect(await db.settings.get('newListGroup')).toBeUndefined()

    // Not a sort / grouping: not written.
    await useSettingsStore.getState().setNewListSort('random' as never)
    await useSettingsStore.getState().setNewListGroup('project' as never)
    expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'manual', newListGroup: 'none' })

    await db.settings.bulkPut([
      { key: 'newListSort', value: 'nope' }, { key: 'newListSortDirection', value: 'desc' }, { key: 'newListGroup', value: '?' },
    ])
    await useSettingsStore.getState().load()
    // A stored direction for Manual reads as none.
    expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'manual', newListSortDirection: 'asc', newListGroup: 'none' })
  })

  it('the purge prompt interval: 7 days by default (no row), 1–365 kept, anything else ignored; the last showing is stamped', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(7)
    expect(useSettingsStore.getState().purgePromptLastAt).toBeNull()

    await useSettingsStore.getState().setPurgePromptIntervalDays(30)
    expect(await db.settings.get('purgePromptIntervalDays')).toEqual({ key: 'purgePromptIntervalDays', value: '30' })
    for (const bad of [0, 366, 2.5, Number.NaN]) await useSettingsStore.getState().setPurgePromptIntervalDays(bad)
    expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(30)
    await useSettingsStore.getState().setPurgePromptIntervalDays(7)
    expect(await db.settings.get('purgePromptIntervalDays')).toBeUndefined()

    const at = new Date('2026-10-20T08:15:00.000Z')
    useUndoStore.getState().clear()
    await useSettingsStore.getState().setPurgePromptLastAt(at)
    expect(await db.settings.get('purgePromptLastAt')).toEqual({ key: 'purgePromptLastAt', value: at.toISOString() })
    // An internal stamp: no undo step, no notice.
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toBeNull()
    useSettingsStore.setState({ purgePromptLastAt: null })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().purgePromptLastAt).toEqual(at)

    await db.settings.bulkPut([{ key: 'purgePromptIntervalDays', value: '0' }, { key: 'purgePromptLastAt', value: 'soon' }])
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(7)
    expect(useSettingsStore.getState().purgePromptLastAt).toBeNull()
  })

  it('the stale threshold: 30 days by default (no row), 0–365 kept (0 = off), anything else ignored; junk on load reads as 30', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().staleAfterDays).toBe(30)
    useUndoStore.getState().clear()

    await useSettingsStore.getState().setStaleAfterDays(0)
    expect(await db.settings.get('staleAfterDays')).toEqual({ key: 'staleAfterDays', value: '0' })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Don’t fade untouched tasks')
    await useSettingsStore.getState().setStaleAfterDays(45)
    expect(await db.settings.get('staleAfterDays')).toEqual({ key: 'staleAfterDays', value: '45' })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Fade tasks untouched for 45 days')
    for (const bad of [-1, 366, 2.5, Number.NaN]) await useSettingsStore.getState().setStaleAfterDays(bad)
    expect(useSettingsStore.getState().staleAfterDays).toBe(45)
    await useSettingsStore.getState().setStaleAfterDays(30)
    expect(await db.settings.get('staleAfterDays')).toBeUndefined()

    await db.settings.put({ key: 'staleAfterDays', value: '14' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().staleAfterDays).toBe(14)
    await db.settings.put({ key: 'staleAfterDays', value: 'soon' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().staleAfterDays).toBe(30)
  })

  it('the lenses: none by default (no row); add, rename, change, duplicate — each one undo step — and read back on load', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().lenses).toEqual([])
    useUndoStore.getState().clear()
    const s = () => useSettingsStore.getState()

    const id = await s().addLens('  Fresh ')
    expect(id).not.toBeNull()
    expect(s().lenses).toEqual([{ id, name: 'Fresh', predicate: emptyPredicate() }])
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('New lens “Fresh”')
    expect(await s().addLens('   ')).toBeNull()

    expect(await s().renameLens(id!, 'Recent')).toBe(true)
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Renamed lens “Fresh” to “Recent”')
    await s().setLensPredicate(id!, { ...emptyPredicate(), showCompleted: true, personIds: [0], negate: { personIds: true } })
    expect(s().lenses[0]!.predicate).toEqual({ ...emptyPredicate(), personIds: [0], negate: { personIds: true } })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Changed lens “Recent”')
    const copy = await s().duplicateLens(id!)
    expect(s().lenses.map((l) => [l.id, l.name])).toEqual([[id, 'Recent'], [copy, 'Recent 2']])
    expect(useUndoStore.getState().undoStack).toHaveLength(4)

    useSettingsStore.setState({ lenses: [] })
    await s().load()
    expect(s().lenses.map((l) => l.name)).toEqual(['Recent', 'Recent 2'])

    await useUndoStore.getState().undo()
    expect(s().lenses.map((l) => l.name)).toEqual(['Recent'])
    await s().setLenses([], 'Deleted lens “Recent”')
    expect(await db.settings.get('lenses')).toBeUndefined()
  })

  it('the preset lenses are seeded once, after the lenses there are, without an undo step', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    const s = () => useSettingsStore.getState()
    await s().addLens('Fresh')
    useUndoStore.getState().clear()

    await s().seedLensPresets(null)
    expect(s().lenses.map((l) => l.name)).toEqual(['Fresh', 'This month', 'Has a person', 'Fresh 2'])
    expect(new Set(s().lenses.map((l) => l.id)).size).toBe(4)
    expect(s().lensPresetsSeeded).toBe(true)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(await db.settings.get('lensPresetsSeeded')).toEqual({ key: 'lensPresetsSeeded', value: 'true' })

    await s().setLenses([], 'Deleted every lens')
    await s().seedLensPresets(3)
    expect(s().lenses).toEqual([])
    useSettingsStore.setState({ lensPresetsSeeded: false })
    await s().load()
    expect(s().lensPresetsSeeded).toBe(true)
  })

  it('the top bar’s lens pick: No lens by default (no row); a pick is saved at once with no undo step, No lens removes the row; a reload reads it back', async () => {
    const s = () => useSettingsStore.getState()
    await s().load()
    expect(s().activeLensId).toBeNull()
    useUndoStore.getState().clear()

    expect(await s().setActiveLens('lens-a')).toBe(true)
    expect(s().activeLensId).toBe('lens-a')
    expect(await db.settings.get('activeLensId')).toEqual({ key: 'activeLensId', value: 'lens-a' })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toBeNull()

    useSettingsStore.setState({ activeLensId: null })
    await s().load()
    expect(s().activeLensId).toBe('lens-a')

    expect(await s().setActiveLens(null)).toBe(true)
    expect(s().activeLensId).toBeNull()
    expect(await db.settings.get('activeLensId')).toBeUndefined()
    await s().load()
    expect(s().activeLensId).toBeNull()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('the lens pick: an id no lens has is kept (it reads as No lens where used); a value that is no lens id is ignored', async () => {
    const s = () => useSettingsStore.getState()
    await db.settings.put({ key: 'activeLensId', value: 'lens-gone' })
    await s().load()
    expect(s().activeLensId).toBe('lens-gone')
    await db.settings.put({ key: 'activeLensId', value: 'x'.repeat(101) })
    await s().load()
    expect(s().activeLensId).toBeNull()
    expect(await s().setActiveLens('')).toBe(false)
    expect(await db.settings.get('activeLensId')).toEqual({ key: 'activeLensId', value: 'x'.repeat(101) })
  })

  it('a failed save of the lens pick puts it back and says so', async () => {
    const s = () => useSettingsStore.getState()
    await s().load()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('quota'))
    expect(await s().setActiveLens('lens-a')).toBe(false)
    expect(s().activeLensId).toBeNull()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn’t save the lens pick.', notice: true })
  })

  it('quick picks: an earlier pick’s save failing after a later pick saved keeps the later pick (on screen and stored)', async () => {
    const s = () => useSettingsStore.getState()
    await s().load()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let failFirst: (e: Error) => void = () => {}
    vi.spyOn(settingsRepository, 'put').mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject }))
    const first = s().setActiveLens('lens-a')
    const second = s().setActiveLens('lens-b')
    expect(await second).toBe(true)
    failFirst(new Error('quota'))
    expect(await first).toBe(false)
    expect(s().activeLensId).toBe('lens-b')
    expect(await db.settings.get('activeLensId')).toEqual({ key: 'activeLensId', value: 'lens-b' })
  })

  it('the row density: compact by default (no row); comfortable stored, compact removes the row; junk ignored on load', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().rowDensity).toBe('compact')
    useUndoStore.getState().clear()

    await useSettingsStore.getState().setRowDensity('comfortable')
    expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'comfortable' })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Comfortable rows')
    await useSettingsStore.getState().setRowDensity('cosy' as never)
    expect(useSettingsStore.getState().rowDensity).toBe('comfortable')
    await useSettingsStore.getState().setRowDensity('compact')
    expect(await db.settings.get('rowDensity')).toBeUndefined()

    await db.settings.put({ key: 'rowDensity', value: 'comfortable' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().rowDensity).toBe('comfortable')
    await db.settings.put({ key: 'rowDensity', value: 'roomy' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().rowDensity).toBe('compact')
  })

  it('new-list sort / grouping and the purge interval: each change is one undo step with the snackbar; undo / redo save', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()

    await useSettingsStore.getState().setNewListSort('deadline', 'desc')
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['New lists sort by Due date ↓'])
    expect(useUndoStore.getState().snackbar?.description).toBe('New lists sort by Due date ↓')
    await useSettingsStore.getState().setNewListGroup('people')
    await useSettingsStore.getState().setPurgePromptIntervalDays(14)
    // The same value again: nothing to undo.
    await useSettingsStore.getState().setNewListGroup('people')
    await useSettingsStore.getState().setPurgePromptIntervalDays(14)
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual([
      'New lists sort by Due date ↓', 'New lists group by People', 'Ask about old completed tasks at most every 14 days',
    ])

    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(7)
    expect(await db.settings.get('purgePromptIntervalDays')).toBeUndefined()
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().newListGroup).toBe('none')
    expect(await db.settings.get('newListGroup')).toBeUndefined()
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'manual', newListSortDirection: 'asc' })
    expect(await db.settings.get('newListSort')).toBeUndefined()
    expect(await db.settings.get('newListSortDirection')).toBeUndefined()
    // Undoing pushed nothing new.
    expect(useUndoStore.getState().undoStack).toHaveLength(0)

    await useUndoStore.getState().redo()
    expect(useSettingsStore.getState()).toMatchObject({ newListSort: 'deadline', newListSortDirection: 'desc' })
    expect(await db.settings.get('newListSortDirection')).toEqual({ key: 'newListSortDirection', value: 'desc' })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })

  it('a failed save of a new-list default or the purge interval puts the value back, adds no undo step and says so', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const put = vi.spyOn(settingsRepository, 'put').mockRejectedValue(new Error('disk full'))

    await useSettingsStore.getState().setNewListSort('name')
    expect(useSettingsStore.getState().newListSort).toBe('manual')
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn’t save how new lists sort.', notice: true })
    await useSettingsStore.getState().setNewListGroup('tag')
    expect(useSettingsStore.getState().newListGroup).toBe('none')
    await useSettingsStore.getState().setPurgePromptIntervalDays(30)
    expect(useSettingsStore.getState().purgePromptIntervalDays).toBe(7)
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn’t save how often to ask about old completed tasks.')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    put.mockRestore()
    vi.restoreAllMocks()
  })

  it('keyboard shortcuts: start at the defaults, save only changes, refuse clashes, reset one or all', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({})

    const set = useSettingsStore.getState().setShortcut
    expect(await set('command-palette', [{ key: 'p', mod: true, shift: true }])).toBeNull()
    expect(await set('open-settings', [{ key: 'g' }, { key: 'o' }])).toBeNull()
    expect((await db.settings.get('keyboardShortcuts'))!.value).toBe('{"command-palette":"Mod-Shift-p","open-settings":"g o"}')

    // A clash is refused with the reason and nothing is written.
    expect(await set('focus-filters', [{ key: 'p', mod: true, shift: true }])).toMatch(/already used by Command Palette/)
    expect(useSettingsStore.getState().shortcutOverrides['focus-filters']).toBeUndefined()

    // Reload reads them back.
    useSettingsStore.setState({ shortcutOverrides: {} })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({
      'command-palette': [{ key: 'p', mod: true, shift: true }],
      'open-settings': [{ key: 'g' }, { key: 'o' }],
    })

    await useSettingsStore.getState().resetShortcut('command-palette')
    expect((await db.settings.get('keyboardShortcuts'))!.value).toBe('{"open-settings":"g o"}')
    await useSettingsStore.getState().resetAllShortcuts()
    expect(await db.settings.get('keyboardShortcuts')).toBeUndefined()
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({})
  })

  it('keyboard shortcuts: load drops what the editor could not have saved', async () => {
    await db.settings.put({ key: 'keyboardShortcuts', value: '{"focus-filters":"Mod-k","toggle-complete":"x","nope":"y"}' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({ 'toggle-complete': [{ key: 'x' }] })
  })
})

describe('the Eisenhower settings', () => {
  const HAND_OFF = { delegate: { name: 'Hand off', filter: { showCompleted: false, personIds: null, statusIds: [3], searchText: '', dates: {}, markers: { urgent: true, important: false }, negate: { statusIds: true as const } } } }
  const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
  afterEach(() => { vi.restoreAllMocks() })

  it('load reads the panes and the source; absent = the defaults and all tasks; unreadable values read as those too', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState()).toMatchObject({ eisenhowerPanes: {}, eisenhowerListId: null })
    await db.settings.bulkPut([
      { key: 'eisenhowerPanes', value: JSON.stringify({ ...HAND_OFF, later: {} }) },
      { key: 'eisenhowerSource', value: 'list:4' },
    ])
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState()).toMatchObject({ eisenhowerPanes: HAND_OFF, eisenhowerListId: 4 })
    await db.settings.bulkPut([{ key: 'eisenhowerPanes', value: '{oops' }, { key: 'eisenhowerSource', value: 'Team' }])
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState()).toMatchObject({ eisenhowerPanes: {}, eisenhowerListId: null })
  })

  it('setEisenhowerPanes writes at once in the stored form (the row goes at the defaults), one undo step each', async () => {
    await useSettingsStore.getState().setEisenhowerPanes({ ...HAND_OFF, do: { name: 'Do' } }, 'Changed pane “Delegate”')
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual(HAND_OFF)
    expect(await db.settings.get('eisenhowerPanes')).toEqual({ key: 'eisenhowerPanes', value: JSON.stringify(HAND_OFF) })
    await useSettingsStore.getState().setEisenhowerPanes(undefined, 'Reset the Eisenhower panes')
    expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
    // The same panes again: nothing written, no step.
    await useSettingsStore.getState().setEisenhowerPanes({}, 'Nothing')
    expect(undoNames()).toEqual(['Changed pane “Delegate”', 'Reset the Eisenhower panes'])
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual(HAND_OFF)
    expect(await db.settings.get('eisenhowerPanes')).toEqual({ key: 'eisenhowerPanes', value: JSON.stringify(HAND_OFF) })
  })

  it('writes with the same merge key in a row are one undo step; another write ends the run', async () => {
    const set = useSettingsStore.getState().setEisenhowerPanes
    await set({ drop: { name: 'S' } }, 'Renamed pane “Drop”', 'name:drop')
    await set({ drop: { name: 'Someday' } }, 'Renamed pane “Drop”', 'name:drop')
    expect(undoNames()).toEqual(['Renamed pane “Drop”'])
    await set({ drop: { name: 'Someday' }, do: { name: 'Now' } }, 'Renamed pane “Do”', 'name:do')
    await set({ drop: { name: 'Later' }, do: { name: 'Now' } }, 'Renamed pane “Drop”', 'name:drop')
    expect(undoNames()).toEqual(['Renamed pane “Drop”', 'Renamed pane “Do”', 'Renamed pane “Drop”'])
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({ drop: { name: 'Someday' } })
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({})
  })

  it('a name typed back to where it started leaves no undo step', async () => {
    const set = useSettingsStore.getState().setEisenhowerPanes
    await set({ drop: { name: 'S' } }, 'Renamed pane “Drop”', 'name:drop')
    await set({}, 'Renamed pane “Drop”', 'name:drop')
    expect(undoNames()).toEqual([])
    // Typing on starts a new step.
    await set({ drop: { name: 'L' } }, 'Renamed pane “Drop”', 'name:drop')
    expect(undoNames()).toEqual(['Renamed pane “Drop”'])
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({})
  })

  it('a failed save puts the value saved back, adds no undo step and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('disk full'))
    await useSettingsStore.getState().setEisenhowerPanes(HAND_OFF, 'Changed pane “Delegate”')
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({})
    expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
    expect(undoNames()).toEqual([])
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Couldn’t save the Eisenhower panes.', notice: true })
  })

  it('a filter change, Reset pane or Reset all panes shows the undo snackbar; a typed name does not', async () => {
    const set = useSettingsStore.getState().setEisenhowerPanes
    await set({ drop: { name: 'S' } }, 'Renamed pane “Drop”', 'name:drop')
    expect(useUndoStore.getState().snackbar).toBeNull()
    await set(HAND_OFF, 'Changed pane “Hand off”')
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Changed pane “Hand off”' })
    await set(undefined, 'Reset the Eisenhower panes')
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Reset the Eisenhower panes' })
  })

  it('writes are saved one after another: an earlier one failing late leaves the later one shown, saved and undoable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const put = async (key: string, value: string) => { await db.settings.put({ key, value }) }
    let failFirst!: () => void
    vi.spyOn(settingsRepository, 'put')
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = () => reject(new Error('disk full')) }))
      .mockImplementation(put)
    const set = useSettingsStore.getState().setEisenhowerPanes
    const first = set({ drop: { name: 'Someday' } }, 'Renamed pane “Drop”')
    const second = set({ drop: { name: 'Someday' }, do: { name: 'Now' } }, 'Renamed pane “Do”')
    // Both show at once; the second waits for the first's save.
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({ do: { name: 'Now' }, drop: { name: 'Someday' } })
    await vi.waitFor(() => expect(failFirst).toBeDefined())
    failFirst()
    await Promise.all([first, second])
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({ do: { name: 'Now' }, drop: { name: 'Someday' } })
    expect(JSON.parse((await db.settings.get('eisenhowerPanes'))!.value)).toEqual({ do: { name: 'Now' }, drop: { name: 'Someday' } })
    expect(undoNames()).toEqual(['Renamed pane “Do”'])
    // Its undo puts back what was saved before it.
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({})
    expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
  })

  it('the last of several writes failing shows the value saved before them', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const put = async (key: string, value: string) => { await db.settings.put({ key, value }) }
    let failSecond!: () => void
    vi.spyOn(settingsRepository, 'put')
      .mockImplementationOnce(put)
      .mockImplementationOnce(() => new Promise((_, reject) => { failSecond = () => reject(new Error('disk full')) }))
    const set = useSettingsStore.getState().setEisenhowerPanes
    const first = set({ drop: { name: 'Someday' } }, 'Renamed pane “Drop”')
    const second = set({ drop: { name: 'Later' } }, 'Renamed pane “Drop” again')
    await first
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({ drop: { name: 'Later' } })
    await vi.waitFor(() => expect(failSecond).toBeDefined())
    failSecond()
    await second
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({ drop: { name: 'Someday' } })
    expect(JSON.parse((await db.settings.get('eisenhowerPanes'))!.value)).toEqual({ drop: { name: 'Someday' } })
    expect(undoNames()).toEqual(['Renamed pane “Drop”'])
  })

  it('an undo or redo whose save fails stays on its stack and says so', async () => {
    await useSettingsStore.getState().setEisenhowerPanes(HAND_OFF, 'Changed pane “Hand off”')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'delete').mockRejectedValueOnce(new Error('disk full'))
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual(HAND_OFF)
    expect(undoNames()).toEqual(['Changed pane “Hand off”'])
    expect(useUndoStore.getState().snackbar).toEqual({ description: "Couldn't undo: Changed pane “Hand off”", notice: true })
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({})
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('disk full'))
    await useUndoStore.getState().redo()
    expect(useSettingsStore.getState().eisenhowerPanes).toEqual({})
    expect(await db.settings.get('eisenhowerPanes')).toBeUndefined()
    expect(useUndoStore.getState().redoStack.map((e) => e.description)).toEqual(['Changed pane “Hand off”'])
    expect(useUndoStore.getState().snackbar).toEqual({ description: "Couldn't redo: Changed pane “Hand off”", notice: true })
  })
})
