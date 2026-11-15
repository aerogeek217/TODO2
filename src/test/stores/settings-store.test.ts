import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'
import { emptyPredicate } from '../../models/filter-predicate'
import { settingsRepository } from '../../data'
import { DEFAULT_THEMED_COLORS } from '../../models/theme-colors'
import { useUndoStore } from '../../stores/undo-store'
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

  describe('resetColor: one colour back to its default (cr34, answer 18)', () => {
    const s = () => useSettingsStore.getState()
    const inline = (name: string) => document.documentElement.style.getPropertyValue(name)

    it('removes that one override — its row, its inline style — and leaves the others', async () => {
      await s().setColor('dark', 'accent', '#ff0000')
      await s().setColor('dark', 'danger', '#00ff00')
      await s().setColor('light', 'accent', '#0000ff')
      await s().resetColor('dark', 'accent')
      expect(s().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent)
      expect(s().customizedColors.dark).toEqual(['danger'])
      expect(await db.settings.get('color.dark.accent')).toBeUndefined()
      expect(inline('--color-accent')).toBe('')
      expect(inline('--color-accent-dim')).toBe('')
      // The same theme's other override and the other theme's same colour stay.
      expect(s().colors.dark.danger).toBe('#00ff00')
      expect((await db.settings.get('color.dark.danger'))!.value).toBe('#00ff00')
      expect(inline('--color-danger')).toBe('#00ff00')
      expect(s().colors.light.accent).toBe('#0000ff')
      expect(s().customizedColors.light).toEqual(['accent'])
      expect((await db.settings.get('color.light.accent'))!.value).toBe('#0000ff')
    })

    it('a priority follows the colour it follows again, its token tint with it', async () => {
      await s().setColor('dark', 'danger', '#ff0000')
      await s().setColor('dark', 'urgent', '#00ff00')
      await s().setColor('dark', 'focus', '#3b82f6')
      expect(inline('--color-marker-urgent')).toBe('#00ff00')
      await s().resetColor('dark', 'urgent')
      // Nothing of Urgent's own is left: the stylesheet's `var(--color-danger)` applies, Danger's override included.
      expect(inline('--color-marker-urgent')).toBe('')
      expect(inline('--color-marker-urgent-bg')).toBe('')
      expect(s().customizedColors.dark).toEqual(['danger', 'focus'])
      expect(await db.settings.get('color.dark.urgent')).toBeUndefined()
      expect(inline('--color-danger')).toBe('#ff0000')
      // Focus keeps its own.
      expect(inline('--color-marker-focus')).toBe('#3b82f6')
      await s().resetColor('dark', 'focus')
      expect(inline('--color-marker-focus')).toBe('')
      expect(inline('--color-marker-focus-bg')).toBe('')
      expect(inline('--color-marker-focus-text')).toBe('')
    })

    it('a colour with no override: nothing is written; no undo step either way', async () => {
      await s().load()
      useUndoStore.getState().clear()
      const writes = [vi.spyOn(settingsRepository, 'put'), vi.spyOn(settingsRepository, 'delete'), vi.spyOn(settingsRepository, 'writeMany')]
      await s().resetColor('dark', 'accent')
      for (const write of writes) expect(write).not.toHaveBeenCalled()
      await s().setColor('dark', 'accent', '#123456')
      await s().resetColor('dark', 'accent')
      expect(s().colors.dark.accent).toBe(DEFAULT_THEMED_COLORS.dark.accent)
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
    })

    it('it survives a reload: the row is gone, the others load', async () => {
      await s().setColor('light', 'urgent', '#00ff00')
      await s().setColor('light', 'important', '#0000ff')
      await s().resetColor('light', 'urgent')
      useSettingsStore.setState(useSettingsStore.getInitialState(), true)
      await s().load()
      expect(s().customizedColors.light).toEqual(['important'])
      expect(s().colors.light.urgent).toBe(DEFAULT_THEMED_COLORS.light.urgent)
      expect(s().colors.light.important).toBe('#0000ff')
    })
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

  it('light theme: Focus’s own colour is darkened for its typed token’s text, as the accent is (cr34 U6)', async () => {
    const inline = (name: string) => document.documentElement.style.getPropertyValue(name)
    await useSettingsStore.getState().setColor('light', 'focus', '#3b82f6')
    await useSettingsStore.getState().setColor('dark', 'focus', '#8ab4f8')
    // Dark: the colour as it is (the dark theme's `--color-accent-text` is the accent itself).
    expect(inline('--color-marker-focus')).toBe('#8ab4f8')
    expect(inline('--color-marker-focus-text')).toBe('#8ab4f8')
    await useSettingsStore.getState().setThemeMode('light')
    // Light: the ring and glow take the colour as picked; the token's text is darkened.
    expect(inline('--color-marker-focus')).toBe('#3b82f6')
    expect(inline('--color-marker-focus-text')).toBe('color-mix(in srgb, #3b82f6 76%, black)')
    expect(inline('--color-marker-focus-bg')).toBe('color-mix(in srgb, #3b82f6 12%, transparent)')
    await useSettingsStore.getState().setThemeMode('dark')
    expect(inline('--color-marker-focus-text')).toBe('#8ab4f8')
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

  it('the theme, colours, shortcuts and the purge stamp add no undo step', async () => {
    await useSettingsStore.getState().load()
    useUndoStore.getState().clear()
    const s = () => useSettingsStore.getState()
    await s().setThemeMode('light')
    await s().setColor('dark', 'accent', '#123456')
    await s().resetColors()
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

  it('quick changes are saved one after another: an earlier save failing keeps the later value (on screen and stored)', async () => {
    const s = () => useSettingsStore.getState()
    await s().load()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let failFirst: ((e: Error) => void) | undefined
    vi.spyOn(settingsRepository, 'put').mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject }))
    const first = s().setStaleAfterDays(14)
    const second = s().setStaleAfterDays(45)
    // The second shows at once and waits for the first's save.
    expect(s().staleAfterDays).toBe(45)
    await vi.waitFor(() => expect(failFirst).toBeDefined())
    failFirst?.(new Error('quota'))
    await first
    await second
    expect(s().staleAfterDays).toBe(45)
    expect(await db.settings.get('staleAfterDays')).toEqual({ key: 'staleAfterDays', value: '45' })
  })

  it('the default list zoom: auto by default (no row); a level stored, auto removes the row; junk ignored', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('auto')
    useUndoStore.getState().clear()

    await useSettingsStore.getState().setListZoom('stacked')
    expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'stacked' })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Default list zoom: Stacked')
    await useSettingsStore.getState().setListZoom('cosy' as never)
    expect(useSettingsStore.getState().listZoom).toBe('stacked')
    await useSettingsStore.getState().setListZoom('lines')
    expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'lines' })
    // Rows is stored (an older build reads it as Rows); Auto is the absent row (an older build reads Rows too).
    await useSettingsStore.getState().setListZoom('rows')
    expect(await db.settings.get('rowDensity')).toEqual({ key: 'rowDensity', value: 'rows' })
    await useSettingsStore.getState().setListZoom('auto')
    expect(await db.settings.get('rowDensity')).toBeUndefined()
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Default list zoom: Auto')

    await db.settings.put({ key: 'rowDensity', value: 'lines' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('lines')
    await db.settings.put({ key: 'rowDensity', value: 'roomy' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('auto')
  })

  it('a density from before the zoom levels (v79 wrote every stored one as a level) reads as the default', async () => {
    await db.settings.put({ key: 'rowDensity', value: 'comfortable' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().listZoom).toBe('auto')
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

describe('the retired Eisenhower rows', () => {
  it('load reads past them (nothing in the store names them) and a settings write leaves them stored', async () => {
    const panes = { key: 'eisenhowerPanes', value: JSON.stringify({ delegate: { name: 'Hand off' } }) }
    const source = { key: 'eisenhowerSource', value: 'list:4' }
    await db.settings.bulkPut([panes, source])
    await useSettingsStore.getState().load()
    const state = useSettingsStore.getState() as unknown as Record<string, unknown>
    expect(Object.keys(state).filter((k) => /eisenhower/i.test(k))).toEqual([])
    await useSettingsStore.getState().setWeekStartsOn(1)
    expect(await db.settings.get('eisenhowerPanes')).toEqual(panes)
    expect(await db.settings.get('eisenhowerSource')).toEqual(source)
  })
})
