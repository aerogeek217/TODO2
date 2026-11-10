import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createTab, layoutBodyOf, UNSAVED_LAYOUT_ID, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { writeLayoutDraft } from '../../data/draft-storage'
import { useUndoStore } from '../../stores/undo-store'
import { useTagStore } from '../../stores/tag-store'
import { edgeBetween, wholeLine } from '../../utils/workspace-grid'
import { trackSizing } from '../../utils/workspace-table'
import type { LayoutBody } from '../../models/workspace-layout'
import { cell, emptyBody, grid, picture, type GridOptions } from '../helpers/layout-builders'

const T0 = new Date('2026-09-01T09:00:00.000Z')

const KA = cell('ka', [createTab('notes', 'a1'), createTab('calendar', 'a2')], { activeTabId: 'a1' })
const KB = cell('kb', [createTab('eisenhower', 'b1')], { activeTabId: 'b1' })

/** ka (a1 a2) | kb (b1): column tracks A and B, one row R. */
function twoColumns(name = 'Daily', extra: Partial<WorkspaceLayout> = {}, opts: GridOptions = {}): Omit<WorkspaceLayout, 'id'> {
  return {
    sortOrder: 0, name,
    createdAt: T0,
    modifiedAt: T0,
    ...grid([[KA, KB]], { colIds: ['A', 'B'], rowIds: ['R'], ...opts }),
    ...extra,
  }
}

/** The tab ids of cell `cellId`. */
const tabsOf = (l: LayoutBody | null | undefined, cellId: string) => l?.cells.find((c) => c.id === cellId)?.tabs.map((t) => t.id)
const cellOf = (l: LayoutBody | null | undefined, cellId: string) => l?.cells.find((c) => c.id === cellId)

async function seedAndInit(...layouts: Array<Omit<WorkspaceLayout, 'id'>>): Promise<number[]> {
  const ids: number[] = []
  for (const l of layouts) ids.push(await layoutRepository.insert(l))
  if (ids[0] !== undefined) await layoutRepository.setActiveId(ids[0])
  await useWorkspaceStore.getState().init()
  return ids
}

async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
  if (!row) throw new Error(`no layout ${id}`)
  return row
}

const ws = () => useWorkspaceStore.getState()

/**
 * Opens an unsaved new layout as an older build kept it in the browser
 * (its New layout wasn't stored until saved): kept, then a page load.
 */
async function openKeptNewLayout(body: LayoutBody = { ...emptyBody() }, name = 'Untitled layout') {
  writeLayoutDraft({ kind: 'new', name, body })
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  await ws().init()
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

describe('init / default layout', () => {
  it('creates one empty Default layout on an empty database and opens it', async () => {
    await ws().init()
    const layouts = await db.layouts.toArray()
    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({ name: 'Default', ...emptyBody() })
    expect(await layoutRepository.getActiveId()).toBe(layouts[0]!.id)
    expect(ws()).toMatchObject({ hydrated: true, isDirty: false, activeLayoutId: layouts[0]!.id })
    expect(ws().working).toEqual(layouts[0])
  })

  it('is idempotent under concurrent callers (StrictMode double effects, several mounts)', async () => {
    await Promise.all([ws().init(), ws().init(), layoutRepository.ensureDefault(), ws().init(), layoutRepository.ensureDefault()])
    expect(await db.layouts.count()).toBe(1)
    await ws().init()
    expect(await db.layouts.count()).toBe(1)
  })

  it('opens the active layout; a dangling activeLayoutId falls back to the most recently used', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B', { lastUsedAt: new Date('2026-09-05') }))
    expect(ws().activeLayoutId).toBe(a)
    await layoutRepository.setActiveId(999)
    await ws().init()
    expect(ws().activeLayoutId).toBe(b)
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'B'])
  })
})

describe('structural edits and dirty state', () => {
  it('edits mark the layout dirty; undoing the edit by hand clears it', async () => {
    await seedAndInit(twoColumns())
    ws().moveTab('a2', { kind: 'cell', cellId: 'ka', index: 0 })
    expect(ws().isDirty).toBe(true)
    ws().moveTab('a2', { kind: 'cell', cellId: 'ka', index: 1 })
    expect(ws().isDirty).toBe(false)
  })

  it('save writes the working copy and clears dirty; discard reverts', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('lens', { kind: 'insert', edge: 'right' }, { listDefinitionId: 7 })
    expect(tabId).not.toBeNull()
    expect(ws().isDirty).toBe(true)
    expect((await stored(id!)).grid.columns).toHaveLength(2)

    await ws().save()
    expect(ws().isDirty).toBe(false)
    const saved = await stored(id!)
    expect(saved.grid.columns).toHaveLength(3)
    expect(saved.cells[2]!.tabs[0]).toEqual({ id: tabId, kind: 'lens', config: { listDefinitionId: 7 } })
    expect(saved.modifiedAt.getTime()).toBeGreaterThan(T0.getTime())

    ws().closeTab(tabId!)
    expect(ws().working!.grid.columns).toHaveLength(2)
    ws().discard()
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.grid.columns).toHaveLength(3)
  })

  it('a new Neglect map — added, or a tab changed to one — colours by the `Project: …` tags', async () => {
    useTagStore.setState({ tags: [
      { id: 4, name: 'Project: Alpha', color: '#111111' },
      { id: 5, name: 'home', color: '#222222' },
      { id: 6, name: 'Project: Beta', color: '#333333' },
    ] })
    await seedAndInit(twoColumns())
    const tabId = ws().addWidget('neglect', { kind: 'cell', cellId: 'kb' })
    const tabs = () => ws().working!.cells.flatMap((k) => k.tabs)
    expect(tabs().find((t) => t.id === tabId)).toEqual({ id: tabId, kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [4, 6] }, untouchedDays: 14 } })
    ws().changeTabKind('a1', 'neglect')
    expect(tabs().find((t) => t.id === 'a1')?.config).toEqual({ colourBy: { kind: 'tags', tagIds: [4, 6] }, untouchedDays: 14 })
    const seeded = ws().addWidget('neglect', { kind: 'cell', cellId: 'kb' }, { neglectTagIds: [5] })
    expect(tabs().find((t) => t.id === seeded)?.config).toEqual({ colourBy: { kind: 'tags', tagIds: [5] }, untouchedDays: 14 })
  })

  it('a new Project pulse — added, or a tab changed to one — reads the `Project: …` tags', async () => {
    useTagStore.setState({ tags: [
      { id: 4, name: 'Project: Alpha', color: '#111111' },
      { id: 5, name: 'home', color: '#222222' },
      { id: 6, name: 'Project: Beta', color: '#333333' },
    ] })
    await seedAndInit(twoColumns())
    const tabs = () => ws().working!.cells.flatMap((k) => k.tabs)
    for (const kind of ['pulse'] as const) {
      const tabId = ws().addWidget(kind, { kind: 'cell', cellId: 'kb' })
      expect(tabs().find((t) => t.id === tabId)).toEqual({ id: tabId, kind, config: { tagIds: [4, 6] } })
      const seeded = ws().addWidget(kind, { kind: 'cell', cellId: 'kb' }, { tagIds: [5] })
      expect(tabs().find((t) => t.id === seeded)?.config).toEqual({ tagIds: [5] })
    }
    ws().changeTabKind('a1', 'pulse')
    expect(tabs().find((t) => t.id === 'a1')?.config).toEqual({ tagIds: [4, 6] })
  })

  it('split, insert, merge and close are layout changes; a split closed again is not', async () => {
    await seedAndInit(twoColumns())
    const cellId = ws().splitCell('kb', 'bottom')
    expect(cellId).not.toBeNull()
    expect(picture(ws().working!)).toEqual(['ka kb', `ka ${cellId}`])
    expect(ws().isDirty).toBe(true)
    ws().closeCell(cellId!)
    expect(ws().isDirty).toBe(false)
    const inserted = ws().insertTrack('top')
    expect(picture(ws().working!)).toEqual([`${inserted} ${inserted}`, 'ka kb'])
    // No one neighbour shares its whole edge, but the two below cover it together: they grow back
    // over it — the saved arrangement again, its own track ids and sizes, so no change.
    ws().closeCell(inserted!)
    expect(picture(ws().working!)).toEqual(['ka kb'])
    expect(ws().working!.grid.rows.map((t) => t.id)).toEqual(['R'])
    expect(ws().isDirty).toBe(false)
    expect(ws().mergeCells('ka', 'kb')).toBe(true)
    expect(tabsOf(ws().working, 'ka')).toEqual(['a1', 'a2', 'b1'])
    expect(ws().isDirty).toBe(true)
    ws().discard()
    expect(ws().mergeCells('ka', 'zz')).toBe(false)
  })

  it('a column inserted and closed again is the saved layout: its track ids and sizes back, not unsaved', async () => {
    await seedAndInit(twoColumns('Daily', {}, { cols: [300, 700] }))
    const inserted = ws().insertTrack('left')
    expect(picture(ws().working!)).toEqual([`${inserted} ka kb`])
    expect(ws().isDirty).toBe(true)
    ws().closeCell(inserted!)
    expect(ws().working!.grid.columns.map((t) => [t.id, t.weight])).toEqual([['A', 300], ['B', 700]])
    expect(ws().isDirty).toBe(false)
    // Another arrangement keeps its own ids: a split stays a change.
    const split = ws().splitCell('ka', 'right')
    expect(picture(ws().working!)).toEqual([`ka ${split} kb`])
    expect(ws().isDirty).toBe(true)
  })

  it('tab config / change kind are layout changes', async () => {
    await seedAndInit(twoColumns())
    ws().patchTabConfig('a2', 'calendar', { dateTypes: { due: false, followup: true } })
    expect(ws().isDirty).toBe(true)
    ws().discard()
    ws().changeTabKind('b1', 'notes')
    expect(cellOf(ws().working, 'kb')!.tabs[0]).toEqual({ id: 'b1', kind: 'notes', config: {} })
    expect(ws().isDirty).toBe(true)
  })

  it('a glance tab: changing to it and editing its config are layout changes', async () => {
    await seedAndInit(twoColumns())
    ws().changeTabKind('b1', 'trend')
    expect(cellOf(ws().working, 'kb')!.tabs[0]).toEqual(createTab('trend', 'b1'))
    expect(ws().isDirty).toBe(true)
    await ws().save()
    expect(ws().isDirty).toBe(false)
    ws().patchTabConfig('b1', 'trend', { range: '4w' })
    expect(ws().isDirty).toBe(true)
  })

  it('new ids never collide with ones already in the layout', async () => {
    await seedAndInit(twoColumns())
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const id = ws().addWidget('notes', { kind: 'layout' })
      expect(id).not.toBeNull()
      ids.add(id!)
    }
    expect(ids.size).toBe(20)
  })
})

describe('view state', () => {
  it('active tab / row collapse / tab view state persist at once and never mark the layout dirty', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().setActiveTab('a2')
    await ws().setTrackCollapsed('R', true)
    await ws().patchTabViewState('a2', 'calendar', { view: 'month', offset: 3 })
    expect(ws().isDirty).toBe(false)
    const row = await stored(id!)
    expect(row.cells[0]!.activeTabId).toBe('a2')
    expect(row.grid.rows[0]!.collapsed).toBe(true)
    expect(row.cells[0]!.tabs[1]!.viewState).toEqual({ view: 'month', offset: 3 })
    expect(row.modifiedAt).toEqual(T0)
    await ws().setTrackCollapsed(['R'], false)
    expect('collapsed' in (await stored(id!)).grid.rows[0]!).toBe(false)
  })

  it('a details-width write is view state: stored at once, never dirty; clearing removes it', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().patchTabViewState('b1', 'eisenhower', { detailsWidth: 310 })
    expect(ws().isDirty).toBe(false)
    expect(cellOf(await stored(id!), 'kb')!.tabs[0]!.viewState).toEqual({ detailsWidth: 310 })
    await ws().patchTabViewState('b1', 'eisenhower', { detailsWidth: undefined })
    expect(ws().isDirty).toBe(false)
    expect(cellOf(await stored(id!), 'kb')!.tabs[0]!.viewState).toEqual({})
  })

  it('a layout an earlier build stored with a lens pick opens clean — not unsaved, no repair — and drops the key at its next write', async () => {
    const legacy = { lensId: 'lens-a' } as Partial<WorkspaceLayout>
    const [id] = await seedAndInit(twoColumns('Daily', legacy))
    expect('lensId' in (await stored(id!))).toBe(true)
    expect(ws().isDirty).toBe(false)
    expect(ws().repairedIds.size).toBe(0)
    expect(useUndoStore.getState().snackbar).toBeNull()
    expect(ws().working && 'lensId' in ws().working!).toBe(false)
    expect(ws().layouts.every((l) => !('lensId' in l))).toBe(true)
    await ws().setActiveTab('a2')
    expect((await stored(id!)).cells[0]!.activeTabId).toBe('a2')
    expect('lensId' in (await stored(id!))).toBe(false)
  })

  it('a Save drops a legacy lens pick from the stored layout', async () => {
    const legacy = { lensId: 'lens-a' } as Partial<WorkspaceLayout>
    const [id] = await seedAndInit(twoColumns('Daily', legacy))
    ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })
    expect(await ws().save()).toBe(true)
    expect('lensId' in (await stored(id!))).toBe(false)
  })

  it('a Review widget an earlier build stored with a pick and a place opens clean — by that pick’s kind, not unsaved, no repair — and takes the new shape at its next write (board BM)', async () => {
    // As that build stored it: one saved pick, the current task, a day's skips.
    const legacyTab = { id: 'rv', kind: 'review', config: { pick: { kind: 'tag', id: 3 } }, viewState: { sort: 'due', currentId: 7, skipped: { day: '2026-11-09', ids: [4] } } }
    const KR = cell('kr', [legacyTab as unknown as ReturnType<typeof createTab>], { activeTabId: 'rv' })
    const [id] = await seedAndInit({ sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0, ...grid([[KA, KR]], { colIds: ['A', 'B'], rowIds: ['R'] }) })
    expect(cellOf(await stored(id!), 'kr')!.tabs[0]).toEqual(legacyTab)
    expect(ws().isDirty).toBe(false)
    expect(ws().repairedIds.size).toBe(0)
    expect(useUndoStore.getState().snackbar).toBeNull()
    const opened = { id: 'rv', kind: 'review', config: { by: 'tag' }, viewState: { sort: 'due' } }
    expect(cellOf(ws().working, 'kr')!.tabs[0]).toEqual(opened)
    expect(cellOf(ws().saved, 'kr')!.tabs[0]).toEqual(opened)
    // A view-state write (saved at once) stores the row in the new shape; the layout stays saved.
    await ws().patchTabViewState('rv', 'review', { sort: 'title' })
    expect(ws().isDirty).toBe(false)
    expect(cellOf(await stored(id!), 'kr')!.tabs[0]).toEqual({ id: 'rv', kind: 'review', config: { by: 'tag' }, viewState: { sort: 'title' } })
    // Its kind is layout config: a change is unsaved until Save, and going back reads saved again.
    ws().patchTabConfig('rv', 'review', { by: 'person' })
    expect(ws().isDirty).toBe(true)
    ws().patchTabConfig('rv', 'review', { by: 'tag' })
    expect(ws().isDirty).toBe(false)
  })

  it('with unsaved changes: view state still reaches the stored layout, structure does not', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    await ws().patchTabViewState('a2', 'calendar', { offset: -1 })
    await ws().setActiveTab(tabId) // only exists in the working copy
    expect(ws().isDirty).toBe(true)
    const row = await stored(id!)
    expect(row.cells[0]!.tabs[1]!.viewState).toEqual({ offset: -1 })
    expect(tabsOf(row, 'kb')).toEqual(['b1'])
    expect(cellOf(row, 'kb')!.activeTabId).toBe('b1')
    ws().discard()
    expect(ws().working!.cells[0]!.tabs[1]!.viewState).toEqual({ offset: -1 })
  })

  it('a collapse of a row an unsaved split made stays unsaved: the stored row (a neighbour’s too) never collapses', async () => {
    const [id] = await seedAndInit(twoColumns())
    // ka split below: rows R and a new one; kb spans both.
    ws().splitCell('ka', 'bottom')
    expect(ws().working!.grid.rows.map((r) => r.id)[0]).toBe('R')
    await ws().setTrackCollapsed('R', true)
    expect(ws().working!.grid.rows[0]!.collapsed).toBe(true)
    expect((await stored(id!)).grid.rows[0]!.collapsed).toBeUndefined()
    await ws().discard()
    expect(ws().working!.grid.rows[0]!.collapsed).toBeUndefined()
  })
})

describe('view state written while a Save runs', () => {
  afterEach(() => { vi.restoreAllMocks() })

  /**
   * Holds the layout writes behind `gate`, in call order — as IndexedDB runs
   * read-write transactions on one store: each starts after the one before.
   */
  function holdLayoutWrites() {
    let release!: () => void
    let chain: Promise<unknown> = new Promise<void>((r) => { release = r })
    const queue = <T>(run: () => Promise<T>): Promise<T> => {
      const p = chain.then(run)
      chain = p.catch(() => undefined)
      return p
    }
    const put = layoutRepository.put.bind(layoutRepository)
    const updateView = layoutRepository.updateView.bind(layoutRepository)
    vi.spyOn(layoutRepository, 'put').mockImplementation((l) => queue(() => put(l)))
    vi.spyOn(layoutRepository, 'updateView').mockImplementation((id, fn) => queue(() => updateView(id, fn)))
    return () => release()
  }

  it('a tab switched while the Save writes keeps the saved structure, stored and on a reload, with the switch', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    const release = holdLayoutWrites()
    const saving = ws().save()
    const switching = ws().setActiveTab('a2')
    release()
    expect(await saving).toBe(true)
    await switching

    const row = await stored(id!)
    expect(tabsOf(row, 'kb')).toEqual(['b1', tabId])
    expect(row.cells[0]!.activeTabId).toBe('a2')
    expect(ws().isDirty).toBe(false)
    expect(ws().saved!.cells[0]!.activeTabId).toBe('a2')
    expect(tabsOf(ws().saved, 'kb')).toEqual(['b1', tabId])

    vi.restoreAllMocks()
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    expect(ws().isDirty).toBe(false)
    expect(tabsOf(ws().working, 'kb')).toEqual(['b1', tabId])
    expect(ws().working!.cells[0]!.activeTabId).toBe('a2')
  })

  it('a view change made before the Save is in what it writes', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })
    const release = holdLayoutWrites()
    const switching = ws().setActiveTab('a2')
    const saving = ws().save()
    release()
    await Promise.all([switching, saving])
    const row = await stored(id!)
    expect(row.cells[0]!.activeTabId).toBe('a2')
    expect(tabsOf(row, 'kb')).toHaveLength(2)
    expect(ws().saved).toEqual(row)
  })

  it('a switch to a tab only the Save writes, made while it writes, is stored with it', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    await ws().setActiveTab('b1')
    const release = holdLayoutWrites()
    const saving = ws().save()
    const switching = ws().setActiveTab(tabId)
    release()
    await Promise.all([saving, switching])
    expect(cellOf(await stored(id!), 'kb')!.activeTabId).toBe(tabId)
    expect(cellOf(ws().saved, 'kb')!.activeTabId).toBe(tabId)
  })

  it('a resize among the tracks the Save writes, made while it writes, is stored with it and stays saved', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().addWidget('notes', { kind: 'insert', edge: 'right' })
    const release = holdLayoutWrites()
    const saving = ws().save()
    const resizing = ws().setTrackSizes({ A: 2000 })
    release()
    expect(await saving).toBe(true)
    await resizing
    const row = await stored(id!)
    expect(row.grid.columns).toHaveLength(3)
    expect(row.grid.columns[0]!.weight).toBe(2000)
    expect(ws().isDirty).toBe(false)
    expect(ws().saved).toEqual(row)

    vi.restoreAllMocks()
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.grid.columns[0]!.weight).toBe(2000)
  })
})

describe('sizes are view state', () => {
  afterEach(() => { vi.restoreAllMocks() })

  /** A reload: a fresh store opening the same database and browser storage. */
  async function reload() {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
  }

  const weights = (l: LayoutBody | null | undefined) => l?.grid.columns.map((c) => c.weight)
  /** ka | kb over R, and a fixed 140px row T across both. */
  const withFixedRow = () => ({ ...twoColumns(), ...grid([[KA, KB], [cell('kt', [createTab('notes', 't1')]), cell('kt', [createTab('notes', 't1')])]], { colIds: ['A', 'B'], rowIds: ['R', 'T'], rows: [1000, { px: 140 }] }) })

  it('a resize is saved at once: never unsaved, kept by Discard and a reload, nothing kept in the browser', async () => {
    const [id] = await seedAndInit(withFixedRow())
    await ws().setTrackSizes({ A: 1400, B: 600 })
    await ws().setTrackSizes({ T: 230 })
    expect(ws().isDirty).toBe(false)
    expect(weights(await stored(id!))).toEqual([1400, 600])
    expect((await stored(id!)).grid.rows[1]).toEqual({ id: 'T', px: 230 })
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    await ws().discard()
    expect(weights(ws().working)).toEqual([1400, 600])
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(weights(ws().working)).toEqual([1400, 600])
    expect(ws().working!.grid.rows[1]?.px).toBe(230)
  })

  it('the frames of a divider drag write nothing; its end saves the result once', async () => {
    const [id] = await seedAndInit(withFixedRow())
    const updateView = vi.spyOn(layoutRepository, 'updateView')
    await ws().setTrackSizes({ A: 1200, B: 800 }, { live: true })
    await ws().setTrackSizes({ A: 1400, B: 600 }, { live: true })
    await ws().setTrackSizes({ T: 180 }, { live: true })
    expect(weights(ws().working)).toEqual([1400, 600])
    expect(ws().isDirty).toBe(false)
    expect(updateView).not.toHaveBeenCalled()
    expect(weights(await stored(id!))).toEqual([1000, 1000])
    await ws().endResize()
    expect(updateView).toHaveBeenCalledOnce()
    expect(weights(await stored(id!))).toEqual([1400, 600])
    expect((await stored(id!)).grid.rows[1]?.px).toBe(180)
    await ws().endResize()
    expect(updateView).toHaveBeenCalledOnce()
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(weights(ws().working)).toEqual([1400, 600])
  })

  it('moveEdge: a whole line is a resize (view state); part of a line a layout change', async () => {
    // ka kb
    // kc kd
    const kc = cell('kc', [createTab('notes', 'c1')])
    const kd = cell('kd', [createTab('notes', 'd1')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[KA, KB], [kc, kd]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    await ws().moveEdge(wholeLine(ws().working!, 'columns', 1), 100, { sizes: [400, 400] })
    expect(ws().isDirty).toBe(false)
    expect(weights(await stored(id!))).toEqual([1250, 750])
    // Only the ka / kc part of the row line: it leaves kb / kd's behind.
    const part = { ...edgeBetween(ws().working!, 'ka', 'kc')!, to: 1 }
    await ws().moveEdge(part, 50, { sizes: [400, 400], minPx: () => 20 })
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.grid.rows).toHaveLength(3)
  })

  it('a Numbers-only row: its divider gives it a height (fitPx), saved at once, its weight kept; clearing it lets it fit again', async () => {
    // kn (a Number) | kc (a Number) over R; kb across S.
    const kn = cell('kn', [createTab('number', 'n1')])
    const kc = cell('kc', [createTab('number', 'n2')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[kn, kc], [KB, KB]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    await ws().moveEdge(wholeLine(ws().working!, 'rows', 1), 40, { sizes: [76, 600] })
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.grid.rows[0]).toEqual({ id: 'R', weight: 1000, fitPx: 116 })
    expect((await stored(id!)).grid.rows[0]).toEqual({ id: 'R', weight: 1000, fitPx: 116 })
    await ws().clearTrackFitPx('R')
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.grid.rows[0]).toEqual({ id: 'R', weight: 1000 })
    expect((await stored(id!)).grid.rows[0]).toEqual({ id: 'R', weight: 1000 })
  })

  it('a Numbers-only row\'s height set under an unsaved row edit reaches the saved layout; so does clearing it', async () => {
    const kn = cell('kn', [createTab('number', 'n1')])
    const kc = cell('kc', [createTab('number', 'n2')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[kn, kc], [KB, KB]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    ws().insertTrack('bottom')
    expect(ws().isDirty).toBe(true)
    await ws().moveEdge(wholeLine(ws().working!, 'rows', 1), 40, { sizes: [76, 300, 300] })
    expect(ws().working!.grid.rows[0]?.fitPx).toBe(116)
    expect((await stored(id!)).grid.rows[0]).toEqual({ id: 'R', weight: 1000, fitPx: 116 })
    await ws().clearTrackFitPx('R')
    expect((await stored(id!)).grid.rows[0]).toEqual({ id: 'R', weight: 1000 })
    expect(ws().isDirty).toBe(true)
  })

  it('a Numbers-only row given a height that stops being one is weighted again, by its own weight', async () => {
    const kn = cell('kn', [createTab('number', 'n1')])
    const kc = cell('kc', [createTab('number', 'n2')])
    await seedAndInit({ ...twoColumns(), ...grid([[kn, kc], [KB, KB]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    await ws().moveEdge(wholeLine(ws().working!, 'rows', 1), 40, { sizes: [76, 600] })
    ws().changeTabKind('n1', 'notes')
    expect(trackSizing(ws().working!, 'rows', 0)).toEqual({ kind: 'weighted', weight: 1000 })
    // A frame copied from the drag's start keeps the weight too.
    const start = ws().working!
    await ws().copyTrackSizes(start, ['rows'])
    expect(ws().working!.grid.rows[0]).toEqual({ id: 'R', weight: 1000, fitPx: 116 })
  })

  it('copyTrackSizes: a live frame from a layout as it started, saved once at the end', async () => {
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[KA, KB]], { colIds: ['A', 'B'], rowIds: ['R'] }) })
    const start = ws().working!
    await ws().copyTrackSizes({ ...start, grid: { ...start.grid, columns: [{ id: 'A', weight: 1500 }, { id: 'B', weight: 500 }] } }, ['columns'], { live: true })
    expect(weights(ws().working)).toEqual([1500, 500])
    expect(weights(await stored(id!))).toEqual([1000, 1000])
    await ws().endResize()
    expect(weights(await stored(id!))).toEqual([1500, 500])
  })

  it('with an unsaved new column: the column widths stay unsaved until Save; the rows save at once', async () => {
    const kc = cell('kc', [createTab('notes', 'a3')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[KA, KB], [kc, KB]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    ws().addWidget('notes', { kind: 'insert', edge: 'right' })
    const added = weights(ws().working)!
    await ws().setTrackSizes({ A: 2000 })
    await ws().setTrackSizes({ R: 300, S: 1700 })
    expect(ws().isDirty).toBe(true)
    const row = await stored(id!)
    expect(weights(row)).toEqual([1000, 1000])
    expect(row.grid.rows.map((r) => r.weight)).toEqual([300, 1700])
    // Kept for a reload with the unsaved column.
    await reload()
    expect(ws().isDirty).toBe(true)
    expect(weights(ws().working)).toEqual([2000, ...added.slice(1)])
    // Discard: the column and its widths go; the row sizes stay saved.
    await ws().discard()
    expect(weights(ws().working)).toEqual([1000, 1000])
    expect(ws().working!.grid.rows.map((r) => r.weight)).toEqual([300, 1700])

    ws().addWidget('notes', { kind: 'insert', edge: 'right' })
    await ws().setTrackSizes({ A: 2000 })
    expect(await ws().save()).toBe(true)
    expect(weights(await stored(id!))).toEqual([2000, ...added.slice(1)])
    expect(ws().isDirty).toBe(false)
  })

  it('a fixed row split by an unsaved edit: its first half’s px stays unsaved, the stored row keeps its own', async () => {
    const [id] = await seedAndInit(withFixedRow())
    // The fixed row's one cell split below: T (70) + a new track (70), the first half keeping T's id.
    ws().splitCell('kt', 'bottom')
    expect(ws().working!.grid.rows.map((r) => r.px)).toEqual([undefined, 70, 70])
    await ws().setTrackSizes({ T: 100 })
    expect(ws().working!.grid.rows[1]!.px).toBe(100)
    expect((await stored(id!)).grid.rows.map((r) => r.px)).toEqual([undefined, 140])
    await ws().discard()
    expect(ws().working!.grid.rows.map((r) => r.px)).toEqual([undefined, 140])
  })

  it('an edit that brings the structure back to the saved one brings back its sizes', async () => {
    await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'insert', edge: 'right' })!
    await ws().setTrackSizes({ B: 200 })
    ws().closeTab(tabId)
    expect(ws().isDirty).toBe(false)
    expect(weights(ws().working)).toEqual([1000, 1000])
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('Save as: the new layout has the sizes; the layout it came from keeps the ones saved at once', async () => {
    const [orig] = await seedAndInit(twoColumns())
    await ws().setTrackSizes({ A: 1400, B: 600 })
    ws().addWidget('notes', { kind: 'insert', edge: 'right' })
    await ws().setTrackSizes({ A: 2000 })
    const copy = await ws().saveAs('Copy')
    expect(weights(await stored(copy!))).toEqual(weights(ws().working))
    expect(weights(await stored(copy!))![0]).toBe(2000)
    expect(weights(await stored(orig!))).toEqual([1400, 600])
    expect(ws().isDirty).toBe(false)
  })

  it('a kept new layout (not stored yet): a resize stays in its working copy, kept for a reload', async () => {
    await seedAndInit(twoColumns())
    await openKeptNewLayout({ ...emptyBody() })
    ws().addWidget('notes', { kind: 'layout' })
    ws().addWidget('notes', { kind: 'layout' })
    const [a, b] = ws().working!.grid.columns.map((c) => c.id)
    await ws().setTrackSizes({ [a!]: 3, [b!]: 1 })
    expect(ws().saved).toBeNull()
    await reload()
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID })
    expect(weights(ws().working)).toEqual([3, 1])
  })
})

describe('saved layouts', () => {
  it('saveAs opens a new layout; the original stays as last saved', async () => {
    const [orig] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    const copy = await ws().saveAs('  Daily copy ')
    expect(copy).not.toBeNull()
    expect(ws()).toMatchObject({ activeLayoutId: copy, isDirty: false })
    expect(ws().working!.name).toBe('Daily copy')
    expect((await stored(copy!)).cells).toHaveLength(1)
    expect((await stored(orig!)).cells).toHaveLength(2)
    expect(await layoutRepository.getActiveId()).toBe(copy)
    expect(ws().layouts.map((l) => l.name)).toEqual(['Daily', 'Daily copy'])
    expect(await ws().saveAs('   ')).toBeNull()
  })

  it('load switches layouts (dropping the working copy) and stamps lastUsedAt', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    await ws().load(b!)
    expect(ws()).toMatchObject({ activeLayoutId: b, isDirty: false })
    expect(ws().working!.cells).toHaveLength(2)
    expect(await layoutRepository.getActiveId()).toBe(b)
    expect((await stored(b!)).lastUsedAt).toBeInstanceOf(Date)
    expect((await stored(a!)).cells).toHaveLength(2)
    await ws().load(999)
    expect(ws().activeLayoutId).toBe(b)
  })

  it('rename never marks dirty and keeps unsaved edits', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    expect(await ws().rename(id!, 'Morning')).toBe(true)
    expect(ws()).toMatchObject({ isDirty: true })
    expect(ws().working!.name).toBe('Morning')
    expect(ws().working!.cells).toHaveLength(1)
    const row = await stored(id!)
    expect(row.name).toBe('Morning')
    expect(row.cells).toHaveLength(2)
    expect(await ws().rename(id!, '')).toBe(false)
  })

  it('rename with a hue stores both at once, never dirty; null clears the hue; no hue leaves it', async () => {
    const [id] = await seedAndInit(twoColumns())
    expect(await ws().rename(id!, 'Morning', 'violet')).toBe(true)
    expect(ws()).toMatchObject({ isDirty: false })
    expect(ws().working).toMatchObject({ name: 'Morning', hue: 'violet' })
    expect(ws().layouts.find((l) => l.id === id)?.hue).toBe('violet')
    expect(await stored(id!)).toMatchObject({ name: 'Morning', hue: 'violet' })
    expect(await ws().rename(id!, 'Evening')).toBe(true)
    expect((await stored(id!)).hue).toBe('violet')
    expect(await ws().rename(id!, 'Evening', '#ff6600')).toBe(true)
    expect((await stored(id!)).hue).toBe('#ff6600')
    expect(ws().working?.hue).toBe('#ff6600')
    expect(await ws().rename(id!, 'Evening', null)).toBe(true)
    expect('hue' in (await stored(id!))).toBe(false)
    expect(ws().working!.hue).toBeUndefined()
  })

  it('createLayout stores an empty layout under its name, after the others, and opens it', async () => {
    const [a] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    const id = await ws().createLayout('  Planning ')
    expect(id).not.toBeNull()
    expect(ws()).toMatchObject({ activeLayoutId: id, isDirty: false, previousLayoutId: null })
    expect(ws().working).toMatchObject({ id, name: 'Planning', ...emptyBody() })
    expect(ws().saved).toEqual(ws().working)
    expect(await stored(id!)).toMatchObject({ name: 'Planning', ...emptyBody(), sortOrder: 2 })
    expect(await layoutRepository.getActiveId()).toBe(id)
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'B', 'Planning'])
    expect((await stored(a!)).cells).toHaveLength(2)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('createLayout refuses an empty name; a failed write stores nothing and says so', async () => {
    const [a] = await seedAndInit(twoColumns('A'))
    expect(await ws().createLayout('   ')).toBeNull()
    vi.spyOn(layoutRepository, 'insert').mockRejectedValueOnce(new Error('quota'))
    expect(await ws().createLayout('Planning')).toBeNull()
    expect(ws().activeLayoutId).toBe(a)
    expect(await db.layouts.count()).toBe(1)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: `Couldn't create layout "Planning".`, notice: true })
  })

  it('a new layout an older build kept unsaved opens unsaved; edits stay in memory', async () => {
    const [a] = await seedAndInit(twoColumns('A'))
    await openKeptNewLayout()
    expect(ws()).toMatchObject({ activeLayoutId: null, saved: null, isDirty: true, previousLayoutId: a })
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID, name: 'Untitled layout', ...emptyBody() })
    expect(await db.layouts.count()).toBe(1)
    ws().addWidget('notes', { kind: 'layout' })
    expect(ws().working!.cells).toHaveLength(1)
    expect(await db.layouts.count()).toBe(1)
  })

  it('saving a kept new layout stores it under its name and opens it', async () => {
    await seedAndInit(twoColumns('A'))
    await openKeptNewLayout()
    expect(await ws().rename(UNSAVED_LAYOUT_ID, 'Planning')).toBe(true)
    expect(await db.layouts.count()).toBe(1)
    ws().addWidget('notes', { kind: 'layout' })
    expect(await ws().save()).toBe(true)
    const id = ws().activeLayoutId
    expect(id).not.toBeNull()
    expect(ws()).toMatchObject({ isDirty: false, previousLayoutId: null })
    expect(ws().working!.name).toBe('Planning')
    expect((await stored(id!)).cells).toHaveLength(1)
    expect(await layoutRepository.getActiveId()).toBe(id)
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'Planning'])
  })

  it('discarding a kept new layout goes back to the layout open before', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    await ws().load(b!)
    await openKeptNewLayout()
    expect(ws().previousLayoutId).toBe(b)
    ws().discard()
    expect(ws()).toMatchObject({ activeLayoutId: b, isDirty: false, previousLayoutId: null })
    expect(ws().working!.name).toBe('B')
    expect(ws().saved!.id).toBe(b)
    expect(a).toBeDefined()
  })

  it('delete refuses the last layout; deleting the open one opens the most recently used', async () => {
    const [a, b, c] = await seedAndInit(
      twoColumns('A'),
      twoColumns('B', { lastUsedAt: new Date('2026-09-09') }),
      twoColumns('C', { lastUsedAt: new Date('2026-09-05') }),
    )
    expect(await ws().delete(c!)).toBe(true)
    expect(ws().activeLayoutId).toBe(a)
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'B'])
    expect(await ws().delete(a!)).toBe(true)
    expect(ws().activeLayoutId).toBe(b)
    expect(ws().layouts.map((l) => l.name)).toEqual(['B'])
    expect(await ws().delete(b!)).toBe(false)
    expect(await db.layouts.count()).toBe(1)
  })
})

describe('unsaved changes kept for a reload', () => {
  /** A reload: a fresh store opening the same database and browser storage. */
  async function reload() {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
  }

  it('an edited layout opens again, still unsaved, with the edit; the database never saw it', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    await reload()
    expect(ws()).toMatchObject({ activeLayoutId: id, isDirty: true })
    expect(picture(ws().working!)).toEqual(['ka'])
    expect((await stored(id!)).cells).toHaveLength(2)
  })

  it('save and discard forget it', async () => {
    await seedAndInit(twoColumns())
    ws().closeTab('b1')
    ws().discard()
    await reload()
    expect(ws().isDirty).toBe(false)
    ws().closeTab('b1')
    await ws().save()
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('view state alone keeps nothing; edits with view state on top come back together', async () => {
    await seedAndInit(twoColumns())
    await ws().setActiveTab('a2')
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    ws().closeTab('b1')
    await ws().setActiveTab('a1')
    await reload()
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.cells[0]!.activeTabId).toBe('a1')
  })

  it('a row inserted and a fixed row resized come back after a reload; a stored layout changed under the draft drops it', async () => {
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[KA, KB], [cell('kt', [createTab('number', 'top1')]), cell('kt', [createTab('number', 'top1')])]], { colIds: ['A', 'B'], rowIds: ['R', 'T'], rows: [1000, { px: 140 }] }) })
    ws().movePanel('kb', { kind: 'insert', edge: 'bottom' })
    await ws().setTrackSizes({ T: 200 })
    expect((await stored(id!)).grid.rows[1]?.px).toBe(200)
    await reload()
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.grid.rows.find((t) => t.id === 'T')?.px).toBe(200)
    expect(ws().working!.cells.at(-1)?.tabs.map((t) => t.id)).toEqual(['b1'])
    // Elsewhere: the stored layout changed under the draft.
    await db.layouts.update(id!, { cells: (await stored(id!)).cells.map((c) => (c.id === 'kt' ? { ...c, tabs: [createTab('notes', 'top9')] } : c)) })
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(tabsOf(ws().working, 'kt')).toEqual(['top9'])
  })

  it('a kept draft an older build made for a resize alone: the sizes are saved, nothing stays unsaved', async () => {
    const [id] = await seedAndInit(twoColumns())
    const base = layoutBodyOf((await stored(id!)))
    const body: LayoutBody = { ...base, grid: { ...base.grid, columns: base.grid.columns.map((c, i) => ({ ...c, weight: i === 0 ? 1500 : 500 })) } }
    writeLayoutDraft({ kind: 'saved', layoutId: id!, base, body })
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.grid.columns.map((c) => c.weight)).toEqual([1500, 500])
    expect((await stored(id!)).grid.columns.map((c) => c.weight)).toEqual([1500, 500])
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('a kept draft of a layout that changed since is dropped', async () => {
    const [a] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    // Elsewhere: the stored layout changed under the draft.
    await db.layouts.update(a!, { ...grid([[KA]]) })
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('a kept new layout comes back new and unsaved while it shows no list; one that shows a list is dropped (every list is a stored layout’s)', async () => {
    const listId = await db.listDefinitions.add({
      name: 'Inbox', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
      membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {} } },
    } as never) as number
    const [a] = await seedAndInit(twoColumns('A'))
    await useListDefinitionStore.getState().load()
    await openKeptNewLayout()
    ws().addWidget('notes', { kind: 'layout' })
    await reload()
    expect(ws()).toMatchObject({ saved: null, isDirty: true, activeLayoutId: null, previousLayoutId: a })
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID, name: 'Untitled layout' })
    expect(ws().working!.cells).toHaveLength(1)

    ws().addWidget('lens', { kind: 'layout' }, { listDefinitionId: listId })
    await reload()
    expect(ws()).toMatchObject({ activeLayoutId: a, isDirty: false })
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('an Eisenhower tab holds no list (its source is a setting): a kept new layout with one survives a list change', async () => {
    const listId = await db.listDefinitions.add({
      name: 'Inbox', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {} } },
    } as never) as number
    await seedAndInit(twoColumns('A'))
    await useListDefinitionStore.getState().load()
    useSettingsStore.setState({ eisenhowerListId: listId })
    await openKeptNewLayout()
    ws().addWidget('eisenhower', { kind: 'layout' }, { listDefinitionId: listId })
    await reload()
    expect(ws().working!.cells[0]!.tabs[0]).toMatchObject({ kind: 'eisenhower', config: {} })

    await db.listDefinitions.update(listId, { name: 'Someone else’s' })
    useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
    await reload()
    expect(ws()).toMatchObject({ saved: null, isDirty: true, activeLayoutId: null })
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID })
  })
})
