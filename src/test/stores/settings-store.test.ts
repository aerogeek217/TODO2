import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { useSettingsStore } from '../../stores/settings-store'

const DARK_DEFAULTS = {
  accent: '#a2cfcb',
  canvasBg: '#0e0e0e',
  surface: '#191a1a',
  danger: '#ee7d77',
  warning: '#f5a623',
  star: '#f5c842',
  scheduled: '#7ec4bc',
  deadline: '#e86bf0',
} as const

const LIGHT_DEFAULTS = {
  accent: '#3a9e93',
  canvasBg: '#f5f4f2',
  surface: '#ffffff',
  danger: '#d94a43',
  warning: '#d08a12',
  star: '#c09a15',
  scheduled: '#3a9e93',
  deadline: '#b838c0',
} as const

beforeEach(async () => {
  await db.delete()
  await db.open()
  useSettingsStore.setState({
    colors: { dark: { ...DARK_DEFAULTS }, light: { ...LIGHT_DEFAULTS } },
    themeMode: 'dark',
    defaultProjectId: null,
    completedRetentionDays: null,
    defaultProjectGroupBy: 'tag',
  })
})

describe('useSettingsStore', () => {
  it('load migrates legacy color.<key> rows to color.dark.<key>', async () => {
    await db.settings.put({ key: 'color.accent', value: '#ff0000' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#ff0000')
    // Other dark keys fall through to defaults
    expect(useSettingsStore.getState().colors.dark.canvasBg).toBe('#0e0e0e')
    // Legacy row migrated and dropped
    expect(await db.settings.get('color.accent')).toBeUndefined()
    expect((await db.settings.get('color.dark.accent'))!.value).toBe('#ff0000')
  })

  it('load reads new-shape color.dark.<key> and color.light.<key> rows', async () => {
    await db.settings.put({ key: 'color.dark.accent', value: '#112233' })
    await db.settings.put({ key: 'color.light.canvasBg', value: '#fafafa' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#112233')
    expect(useSettingsStore.getState().colors.light.canvasBg).toBe('#fafafa')
  })

  it('load ignores invalid colors (legacy + per-theme)', async () => {
    await db.settings.put({ key: 'color.accent', value: 'not-a-color' })
    await db.settings.put({ key: 'color.light.danger', value: 'still-not' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#a2cfcb') // default
    expect(useSettingsStore.getState().colors.light.danger).toBe('#d94a43') // default
  })

  it('load: new key wins over legacy when both exist', async () => {
    await db.settings.put({ key: 'color.accent', value: '#aa0000' })
    await db.settings.put({ key: 'color.dark.accent', value: '#0000aa' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#0000aa')
    // Legacy still gets cleaned up regardless
    expect(await db.settings.get('color.accent')).toBeUndefined()
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
    await useSettingsStore.getState().setColor('dark', 'canvasBg', '#222222')
    expect(useSettingsStore.getState().colors.dark.canvasBg).toBe('#222222')
    expect(useSettingsStore.getState().colors.light.canvasBg).toBe('#f5f4f2')
  })

  it('setColor rejects invalid', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', 'not-valid')
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#a2cfcb') // unchanged
  })

  it('resetColors(theme) restores one bag', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
    await useSettingsStore.getState().setColor('light', 'accent', '#0000ff')
    await useSettingsStore.getState().resetColors('dark')
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#a2cfcb')
    expect(useSettingsStore.getState().colors.light.accent).toBe('#0000ff') // untouched
    expect(await db.settings.get('color.dark.accent')).toBeUndefined()
    expect((await db.settings.get('color.light.accent'))!.value).toBe('#0000ff')
  })

  it('resetColors() with no arg restores both bags', async () => {
    await useSettingsStore.getState().setColor('dark', 'accent', '#ff0000')
    await useSettingsStore.getState().setColor('light', 'accent', '#0000ff')
    await useSettingsStore.getState().resetColors()
    expect(useSettingsStore.getState().colors.dark.accent).toBe('#a2cfcb')
    expect(useSettingsStore.getState().colors.light.accent).toBe('#3a9e93')
  })

  it('setThemeMode flips which override bag drives inline styles', async () => {
    // Customize both bags to distinct values, then verify the inline canvas-bg
    // override flips with the resolved theme.
    await useSettingsStore.getState().setColor('dark', 'canvasBg', '#aabbcc')
    await useSettingsStore.getState().setColor('light', 'canvasBg', '#ddeeff')
    await useSettingsStore.getState().setThemeMode('dark')
    expect(document.documentElement.style.getPropertyValue('--color-canvas-bg')).toBe('#aabbcc')
    await useSettingsStore.getState().setThemeMode('light')
    expect(document.documentElement.style.getPropertyValue('--color-canvas-bg')).toBe('#ddeeff')
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

  it('defaultProjectGroupBy defaults to tag', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().defaultProjectGroupBy).toBe('tag')
  })

  it('setDefaultProjectGroupBy persists and clears', async () => {
    await useSettingsStore.getState().setDefaultProjectGroupBy('people')
    expect(useSettingsStore.getState().defaultProjectGroupBy).toBe('people')
    expect((await db.settings.get('defaultProjectGroupBy'))!.value).toBe('people')

    await useSettingsStore.getState().setDefaultProjectGroupBy(null)
    expect(useSettingsStore.getState().defaultProjectGroupBy).toBeNull()
    expect((await db.settings.get('defaultProjectGroupBy'))!.value).toBe('')
  })

  it('load reads persisted defaultProjectGroupBy and treats empty string as null', async () => {
    await db.settings.put({ key: 'defaultProjectGroupBy', value: 'status' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().defaultProjectGroupBy).toBe('status')

    await db.settings.put({ key: 'defaultProjectGroupBy', value: '' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().defaultProjectGroupBy).toBeNull()
  })

  it('setDefaultProjectGroupBy ignores invalid values', async () => {
    await useSettingsStore.getState().setDefaultProjectGroupBy('tag')
    // Cast through unknown to bypass the type guard for the rejection test.
    await useSettingsStore.getState().setDefaultProjectGroupBy('not-a-group-by' as unknown as 'tag')
    expect(useSettingsStore.getState().defaultProjectGroupBy).toBe('tag')
  })
})

describe('useSettingsStore.load — dormant Dashboard-era keys', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('strips dashboardUserLists / notesPinnedToDashboard / notesDock / notesVisible from IndexedDB', async () => {
    await db.settings.put({ key: 'dashboardUserLists', value: JSON.stringify([1, 2]) })
    await db.settings.put({ key: 'notesPinnedToDashboard', value: 'true' })
    await db.settings.put({ key: 'notesDock', value: 'floating' })
    await db.settings.put({ key: 'notesVisible', value: 'true' })
    await useSettingsStore.getState().load()
    for (const key of ['dashboardUserLists', 'notesPinnedToDashboard', 'notesDock', 'notesVisible']) {
      expect(await db.settings.get(key)).toBeUndefined()
    }
  })
})

describe('useSettingsStore.load canvasViewport parse', () => {
  it('accepts finite numbers', async () => {
    await db.settings.put({ key: 'canvasViewport', value: JSON.stringify({ x: 10, y: -5, zoom: 1.5 }) })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasViewport).toEqual({ x: 10, y: -5, zoom: 1.5 })
  })

  it('rejects Infinity (non-finite after JSON.parse of 1e999)', async () => {
    await db.settings.put({ key: 'canvasViewport', value: '{"x":1e999,"y":0,"zoom":1}' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasViewport).toBeNull()
  })

  it('rejects missing fields', async () => {
    await db.settings.put({ key: 'canvasViewport', value: JSON.stringify({ x: 0, y: 0 }) })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasViewport).toBeNull()
  })
})

describe('useSettingsStore.setCanvasViewport debouncing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({ canvasViewport: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces Zustand set across rapid calls', () => {
    const store = useSettingsStore.getState()
    store.setCanvasViewport({ x: 10, y: 20, zoom: 1 })
    store.setCanvasViewport({ x: 11, y: 21, zoom: 1 })
    store.setCanvasViewport({ x: 12, y: 22, zoom: 1 })

    // Before debounce fires, state is still null
    expect(useSettingsStore.getState().canvasViewport).toBeNull()

    vi.advanceTimersByTime(150)

    // Only the final value lands in the store
    expect(useSettingsStore.getState().canvasViewport).toEqual({ x: 12, y: 22, zoom: 1 })
  })

  it('coalesces 60 per-second calls into a single Zustand update', () => {
    const store = useSettingsStore.getState()
    const spy = vi.spyOn(useSettingsStore, 'setState')

    // Simulate a one-second pan at 60fps
    for (let i = 0; i < 60; i++) {
      store.setCanvasViewport({ x: i, y: 0, zoom: 1 })
      vi.advanceTimersByTime(16) // ~60fps
    }

    // Flush the debounce
    vi.advanceTimersByTime(150)

    // Instead of 60 setState calls, we should have very few — with 150ms
    // trailing debounce over 16ms frames, only the final flush runs.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1)
    expect(useSettingsStore.getState().canvasViewport).toEqual({ x: 59, y: 0, zoom: 1 })

    spy.mockRestore()
  })
})

describe('useSettingsStore.canvasRails persistence', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useSettingsStore.setState({ canvasRails: null })
  })

  it('load parses persisted canvasRails JSON', async () => {
    await db.settings.put({
      key: 'canvasRails',
      value: JSON.stringify({
        left: null,
        right: { orientation: 'vertical', slots: [{ id: 's1', kind: 'lens', listDefinitionId: 7 }] },
        top: null,
        bottom: null,
      }),
    })
    await useSettingsStore.getState().load()
    const rails = useSettingsStore.getState().canvasRails
    expect(rails).not.toBeNull()
    // Legacy shape gets wrapped into a single-tab slot on parse.
    expect(rails!.right!.slots[0]).toEqual({
      id: 's1',
      tabs: [{ id: 's1-t0', type: 'lens', listDefinitionId: 7 }],
      activeTabId: 's1-t0',
    })
  })

  it('load leaves canvasRails null when the blob is malformed', async () => {
    await db.settings.put({ key: 'canvasRails', value: '{not json' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasRails).toBeNull()
  })
})

describe('useSettingsStore.setCanvasRails debouncing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useSettingsStore.setState({ canvasRails: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces Zustand set across rapid calls and retains only the last value', () => {
    const store = useSettingsStore.getState()
    const rails1 = {
      left: null,
      right: { orientation: 'vertical' as const, slots: [{ id: 'a', tabs: [{ id: 'a-t0', type: 'lens' as const }], activeTabId: 'a-t0' }] },
      top: null,
      bottom: null,
    }
    const rails2 = {
      left: null,
      right: { orientation: 'vertical' as const, slots: [{ id: 'b', tabs: [{ id: 'b-t0', type: 'notes' as const }], activeTabId: 'b-t0' }] },
      top: null,
      bottom: null,
    }
    store.setCanvasRails(rails1)
    store.setCanvasRails(rails2)

    expect(useSettingsStore.getState().canvasRails).toBeNull()
    vi.advanceTimersByTime(150)
    expect(useSettingsStore.getState().canvasRails).toEqual(rails2)
  })
})

describe('useSettingsStore.setCanvasRails persistence', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useSettingsStore.setState({ canvasRails: null })
  })

  it('writes the serialized rails blob to the settings repo', async () => {
    const rails = {
      left: null,
      right: { orientation: 'vertical' as const, slots: [{ id: 'x', tabs: [{ id: 'x-t0', type: 'lens' as const, listDefinitionId: 5 }], activeTabId: 'x-t0' }] },
      top: null,
      bottom: null,
    }
    useSettingsStore.getState().setCanvasRails(rails)
    await new Promise((r) => setTimeout(r, 600))
    const row = await db.settings.get('canvasRails')
    expect(row).toBeDefined()
    const parsed = JSON.parse(row!.value)
    expect(parsed.right.slots[0].id).toBe('x')
  })
})

describe('useSettingsStore.canvasMaxExtent', () => {
  beforeEach(() => {
    useSettingsStore.setState({ canvasMaxExtent: 10000 })
  })

  it('defaults to 10000 on a fresh load', async () => {
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(10000)
  })

  it('round-trips via setCanvasMaxExtent', async () => {
    await useSettingsStore.getState().setCanvasMaxExtent(5000)
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(5000)
    const row = await db.settings.get('canvasMaxExtent')
    expect(row?.value).toBe('5000')
  })

  it('rejects values outside [1000, 100000] (state stays unchanged)', async () => {
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(10000)
    await useSettingsStore.getState().setCanvasMaxExtent(99999999)
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(10000)
    await useSettingsStore.getState().setCanvasMaxExtent(0)
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(10000)
    await useSettingsStore.getState().setCanvasMaxExtent(NaN)
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(10000)
  })

  it('load restores a persisted value', async () => {
    await db.settings.put({ key: 'canvasMaxExtent', value: '7500' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(7500)
  })

  it('load falls back to default when the persisted value is invalid', async () => {
    await db.settings.put({ key: 'canvasMaxExtent', value: '999999999' })
    await useSettingsStore.getState().load()
    expect(useSettingsStore.getState().canvasMaxExtent).toBe(10000)
  })
})
