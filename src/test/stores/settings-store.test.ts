import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'
import { emptyPredicate } from '../../models/filter-predicate'
import { settingsRepository } from '../../data'
import { DEFAULT_THEMED_COLORS } from '../../models/theme-colors'
import { useUndoStore } from '../../stores/undo-store'
import { lensActions } from '../../stores/lens-actions'
import { DEFAULT_TAB_BADGES } from '../../utils/tab-badges'
import { DEFAULT_PRIORITY_CUES } from '../../utils/priority-cues'

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

  it('a failed theme or colour save puts the page back too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await useSettingsStore.getState().load()
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('disk full'))
    const saving = useSettingsStore.getState().setThemeMode('light')
    // Shown at once.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    await saving
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Couldn’t save the theme.', notice: true })

    vi.spyOn(settingsRepository, 'writeMany').mockRejectedValueOnce(new Error('disk full'))
    const coloring = useSettingsStore.getState().setColor('dark', 'accent', '#123456')
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#123456')
    await coloring
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('')
    expect(useSettingsStore.getState().customizedColors.dark).toEqual([])
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Couldn’t save the theme colors.', notice: true })
    vi.restoreAllMocks()
  })

  it('the Task defaults and the retention are one undo step each, with the snackbar', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    const s = () => useSettingsStore.getState()
    await s().setDefaultStatusId(3)
    await s().setDefaultStatusId(null)
    await s().setAutoFollowup(false)
    await s().setFollowupDefaultInterval({ count: 10, unit: 'd' })
    await s().setRemoveConvertedLines(true)
    await s().setUrgentDueWithinDays(null)
    await s().setUrgentDueWithinDays(0)
    await s().setWeekStartsOn(0)
    await s().setCompletedRetentionDays(14)
    await s().setCompletedRetentionDays(null)
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual([
      'Changed the default status', 'No default status',
      'Don’t set a next follow-up automatically', 'Follow-up interval 10 days', 'Remove note lines after converting',
      'Due dates don’t make tasks urgent', 'Due today makes a task urgent', 'Weeks start on Sunday',
      'Offer to delete completed tasks after 14 days', 'Don’t offer to delete completed tasks',
    ])
    expect(useUndoStore.getState().snackbar?.description).toBe('Don’t offer to delete completed tasks')
    await useUndoStore.getState().undo()
    expect(s().completedRetentionDays).toBe(14)
    expect(await db.settings.get('completedRetentionDays')).toEqual({ key: 'completedRetentionDays', value: '14' })
  })

  it('the theme, colours, check-in method, shortcuts and the purge stamp add no undo step', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    const s = () => useSettingsStore.getState()
    await s().setThemeMode('light')
    await s().setColor('dark', 'accent', '#123456')
    await s().resetColors()
    await s().setCheckinOpenMethod('eml')
    await s().setShortcut('command-palette', [{ key: 'p', mod: true, shift: true }])
    await s().resetAllShortcuts()
    await s().setPurgePromptLastAt(new Date())
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
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
    useSettingsStore.setState({ checkinTaskFilter: { ...emptyPredicate(), markers: [{ values: ['focus' as const] }] } })
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

    const id = await lensActions.addLens('  Fresh ')
    expect(id).not.toBeNull()
    expect(s().lenses).toEqual([{ id, name: 'Fresh', predicate: emptyPredicate() }])
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('New lens “Fresh”')
    expect(await lensActions.addLens('   ')).toBeNull()

    expect(await lensActions.renameLens(id!, 'Recent')).toBe(true)
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Renamed lens “Fresh” to “Recent”')
    await lensActions.setLensPredicate(id!, { ...emptyPredicate(), showCompleted: true, personIds: [0], negate: { personIds: true } })
    expect(s().lenses[0]!.predicate).toEqual({ ...emptyPredicate(), personIds: [0], negate: { personIds: true } })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Changed lens “Recent”')
    const copy = await lensActions.duplicateLens(id!)
    expect(s().lenses.map((l) => [l.id, l.name])).toEqual([[id, 'Recent'], [copy, 'Recent 2']])
    expect(useUndoStore.getState().undoStack).toHaveLength(4)

    useSettingsStore.setState({ lenses: [] })
    await s().load()
    expect(s().lenses.map((l) => l.name)).toEqual(['Recent', 'Recent 2'])

    await useUndoStore.getState().undo()
    expect(s().lenses.map((l) => l.name)).toEqual(['Recent'])
    await lensActions.setLenses([], 'Deleted lens “Recent”')
    expect(await db.settings.get('lenses')).toBeUndefined()
  })

  it('moveLens: one undo step, saved at once and read back on load; out of range or in place changes nothing; a failed save puts the order back', async () => {
    await useSettingsStore.getState().load()
    const s = () => useSettingsStore.getState()
    const a = await lensActions.addLens('A')
    await lensActions.addLens('B')
    await lensActions.addLens('C')
    useUndoStore.getState().clear()
    const names = () => s().lenses.map((l) => l.name)

    expect(await lensActions.moveLens(0, 2)).toBe(true)
    expect(names()).toEqual(['B', 'C', 'A'])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Moved lens “A”'])
    useSettingsStore.setState({ lenses: [] })
    await s().load()
    expect(names()).toEqual(['B', 'C', 'A'])
    expect(s().lenses[2]!.id).toBe(a)

    expect(await lensActions.moveLens(2, 0)).toBe(true)
    expect(names()).toEqual(['A', 'B', 'C'])
    await useUndoStore.getState().undo()
    expect(names()).toEqual(['B', 'C', 'A'])
    useSettingsStore.setState({ lenses: [] })
    await s().load()
    expect(names()).toEqual(['B', 'C', 'A'])

    useUndoStore.getState().clear()
    expect(await lensActions.moveLens(1, 1)).toBe(true)
    for (const [from, to] of [[-1, 0], [3, 0], [0, 3], [0, -1], [0.5, 1]] as const) expect(await lensActions.moveLens(from, to)).toBe(false)
    expect(names()).toEqual(['B', 'C', 'A'])
    expect(useUndoStore.getState().undoStack).toHaveLength(0)

    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('quota'))
    expect(await lensActions.moveLens(0, 1)).toBe(false)
    expect(names()).toEqual(['B', 'C', 'A'])
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn’t save the lenses.', notice: true })
    vi.restoreAllMocks()
  })

  it('the preset lenses are seeded once, after the lenses there are, without an undo step', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    const s = () => useSettingsStore.getState()
    await lensActions.addLens('Fresh')
    useUndoStore.getState().clear()

    await lensActions.seedLensPresets(null)
    expect(s().lenses.map((l) => l.name)).toEqual(['Fresh', 'This month', 'Has a person', 'Fresh 2'])
    expect(new Set(s().lenses.map((l) => l.id)).size).toBe(4)
    expect(s().lensPresetsSeeded).toBe(true)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(await db.settings.get('lensPresetsSeeded')).toEqual({ key: 'lensPresetsSeeded', value: 'true' })

    await lensActions.setLenses([], 'Deleted every lens')
    await lensActions.seedLensPresets(3)
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

    expect(await lensActions.setActiveLens('lens-a')).toBe(true)
    expect(s().activeLensId).toBe('lens-a')
    expect(await db.settings.get('activeLensId')).toEqual({ key: 'activeLensId', value: 'lens-a' })
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toBeNull()

    useSettingsStore.setState({ activeLensId: null })
    await s().load()
    expect(s().activeLensId).toBe('lens-a')

    expect(await lensActions.setActiveLens(null)).toBe(true)
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
    expect(await lensActions.setActiveLens('')).toBe(false)
    expect(await db.settings.get('activeLensId')).toEqual({ key: 'activeLensId', value: 'x'.repeat(101) })
  })

  it('a failed save of the lens pick puts it back and says so', async () => {
    const s = () => useSettingsStore.getState()
    await s().load()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('quota'))
    expect(await lensActions.setActiveLens('lens-a')).toBe(false)
    expect(s().activeLensId).toBeNull()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn’t save the lens pick.', notice: true })
  })

  it('quick picks are saved one after another: an earlier pick’s save failing keeps the later pick (on screen and stored)', async () => {
    const s = () => useSettingsStore.getState()
    await s().load()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let failFirst: ((e: Error) => void) | undefined
    vi.spyOn(settingsRepository, 'put').mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject }))
    const first = lensActions.setActiveLens('lens-a')
    const second = lensActions.setActiveLens('lens-b')
    // The second shows at once and waits for the first's save.
    expect(s().activeLensId).toBe('lens-b')
    await vi.waitFor(() => expect(failFirst).toBeDefined())
    failFirst?.(new Error('quota'))
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(s().activeLensId).toBe('lens-b')
    expect(await db.settings.get('activeLensId')).toEqual({ key: 'activeLensId', value: 'lens-b' })
  })

  it('the default list zoom: rows by default (no row); a level stored, rows removes the row; junk ignored', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('rows')
    useUndoStore.getState().clear()

    await useSettingsStore.getState().setListZoom('stacked')
    expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'stacked' })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Default list zoom: Stacked')
    await useSettingsStore.getState().setListZoom('cosy' as never)
    expect(useSettingsStore.getState().listZoom).toBe('stacked')
    await useSettingsStore.getState().setListZoom('strips')
    expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'strips' })
    await useSettingsStore.getState().setListZoom('rows')
    expect(await db.settings.get('rowDensity')).toBeUndefined()

    await db.settings.put({ key: 'rowDensity', value: 'lines' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('lines')
    await db.settings.put({ key: 'rowDensity', value: 'roomy' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('rows')
  })

  it('reads the densities before the zoom levels as levels: comfortable is Stacked, compact is Rows', async () => {
    await db.settings.put({ key: 'rowDensity', value: 'comfortable' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('stacked')
    await db.settings.put({ key: 'rowDensity', value: 'compact' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('rows')
  })

  it('the row dates: relative by default (no row); numeric stored, relative removes the row; junk ignored on load', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().rowDates).toBe('relative')
    useUndoStore.getState().clear()

    await useSettingsStore.getState().setRowDates('numeric')
    expect(await db.settings.get('rowDates')).toEqual({ key: 'rowDates', value: 'numeric' })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('MM/DD dates on rows')
    await useSettingsStore.getState().setRowDates('short' as never)
    expect(useSettingsStore.getState().rowDates).toBe('numeric')
    await useSettingsStore.getState().setRowDates('relative')
    expect(await db.settings.get('rowDates')).toBeUndefined()
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Relative dates on rows')

    await db.settings.put({ key: 'rowDates', value: 'numeric' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().rowDates).toBe('numeric')
    await db.settings.put({ key: 'rowDates', value: 'words' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().rowDates).toBe('relative')
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
    // The sort and its direction are written together in one transaction.
    vi.spyOn(settingsRepository, 'writeMany').mockRejectedValue(new Error('disk full'))

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

  it('tab badges and priority cues: one undo step each with the snackbar; the same value again writes nothing (cr31 A5)', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    await useSettingsStore.getState().setTabBadges({ due: 7, followup: 'off' })
    expect(useSettingsStore.getState().tabBadges).toEqual({ due: 7, followup: 'off' })
    expect((await db.settings.get('tabBadgeDue'))?.value).toBe('7')
    expect((await db.settings.get('tabBadgeFollowup'))?.value).toBe('off')
    expect(useUndoStore.getState().snackbar?.description).toBe('Changed the tab badges')
    await useSettingsStore.getState().setTabBadges({ due: 7, followup: 'off' })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)

    const cues = { focus: { glow: true, semibold: true }, urgent: { glow: false, semibold: false }, important: { glow: false, semibold: false } }
    await useSettingsStore.getState().setPriorityCues(cues)
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Changed the tab badges', 'Changed the priority cues'])

    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().priorityCues).toEqual(DEFAULT_PRIORITY_CUES)
    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().tabBadges).toEqual(DEFAULT_TAB_BADGES)
    expect((await db.settings.get('tabBadgeDue'))?.value).toBe('3')
    expect((await db.settings.get('tabBadgeFollowup'))?.value).toBe('0')
  })

  it('a failed tab-badge save stores neither range, puts both back and says so (cr31 A5)', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The first row's write goes through, the second fails: the transaction takes both back.
    const realPut = db.settings.put.bind(db.settings)
    let calls = 0
    const put = vi.spyOn(db.settings, 'put').mockImplementation(((row: { key: string; value: string }) => {
      calls++
      return calls === 1 ? realPut(row) : Promise.reject(new Error('disk full'))
    }) as never)
    await useSettingsStore.getState().setTabBadges({ due: 7, followup: 'off' })
    put.mockRestore()
    expect(calls).toBe(2)
    expect(await db.settings.get('tabBadgeDue')).toBeUndefined()
    expect(await db.settings.get('tabBadgeFollowup')).toBeUndefined()
    expect(useSettingsStore.getState().tabBadges).toEqual(DEFAULT_TAB_BADGES)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn’t save the tab badges.', notice: true })
  })

  it('a failed priority-cue save puts them back, adds no step and says so (cr31 A5)', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put').mockRejectedValue(new Error('disk full'))
    await useSettingsStore.getState().setPriorityCues({ ...DEFAULT_PRIORITY_CUES, focus: { glow: true, semibold: false } })
    expect(useSettingsStore.getState().priorityCues).toEqual(DEFAULT_PRIORITY_CUES)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn’t save the priority cues.', notice: true })
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
  const HAND_OFF = { delegate: { name: 'Hand off', filter: { showCompleted: false, personIds: null, statusIds: [3], searchText: '', dates: {}, markers: [{ values: ['urgent' as const] }, { values: ['important' as const], not: true as const }], negate: { statusIds: true as const } } } }
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

  it('a pane filter written as an expression is stored as one', async () => {
    const base = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
    const expression = { kind: 'or' as const, items: [{ kind: 'status' as const, id: 3 }, { kind: 'priority' as const, value: 'focus' as const }] }
    await useSettingsStore.getState().setEisenhowerPanes({ drop: { filter: { ...base, expression } } }, 'Changed pane “Drop”')
    expect(useSettingsStore.getState().eisenhowerPanes.drop?.filter?.expression).toEqual(expression)
    expect(JSON.parse((await db.settings.get('eisenhowerPanes'))!.value).drop.filter).toMatchObject({ expression })
    expect(undoNames()).toEqual(['Changed pane “Drop”'])
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
