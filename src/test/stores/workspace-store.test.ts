import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { createTab, layoutBodyOf, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { registerOpenEditor } from '../../stores/editor-leave'
import { writeLayoutDraft } from '../../data/draft-storage'
import { useUndoStore } from '../../stores/undo-store'
import { useTagStore } from '../../stores/tag-store'
import { edgeBetween, wholeLine } from '../../utils/workspace-grid'
import { trackSizing } from '../../utils/workspace-table'
import type { LayoutBody } from '../../models/workspace-layout'
import { cell, emptyBody, grid, picture, type GridOptions } from '../helpers/layout-builders'

const T0 = new Date('2026-09-01T09:00:00.000Z')

const KA = cell('ka', [createTab('notes', 'a1'), createTab('calendar', 'a2')], { activeTabId: 'a1' })
const KB = cell('kb', [createTab('lens', 'b1')], { activeTabId: 'b1' })

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
  await settleLayoutWrites()
  const row = (await db.layouts.get(id)) as PersistedWorkspaceLayout | undefined
  if (!row) throw new Error(`no layout ${id}`)
  return row
}

const ws = () => useWorkspaceStore.getState()
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const undo = () => useUndoStore.getState().undo()
const redo = () => useUndoStore.getState().redo()

/** A reload: a fresh store opening the same database and browser storage. */
async function reload() {
  await settleLayoutWrites()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  await ws().init()
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

afterEach(() => { vi.restoreAllMocks() })

describe('init / default layout', () => {
  it('creates one empty Default layout on an empty database and opens it', async () => {
    await ws().init()
    const layouts = await db.layouts.toArray()
    expect(layouts).toHaveLength(1)
    expect(layouts[0]).toMatchObject({ name: 'Default', ...emptyBody() })
    expect(await layoutRepository.getActiveId()).toBe(layouts[0]!.id)
    expect(ws()).toMatchObject({ hydrated: true, writeFailed: false, activeLayoutId: layouts[0]!.id })
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

describe('structural edits are saved at once, each an undo step', () => {
  it('an edit is stored at once, named in the snackbar; Undo puts it back, Redo again — each stored', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().moveTab('a2', { kind: 'cell', cellId: 'kb', index: 0 })
    expect(tabsOf(ws().working, 'kb')).toEqual(['a2', 'b1'])
    expect(ws().saved).toBe(ws().working)
    expect(tabsOf(await stored(id!), 'kb')).toEqual(['a2', 'b1'])
    expect((await stored(id!)).modifiedAt.getTime()).toBeGreaterThan(T0.getTime())
    expect(undoNames()).toEqual(['Moved “Calendar”'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Moved “Calendar”')

    await undo()
    expect(tabsOf(ws().working, 'kb')).toEqual(['b1'])
    expect(tabsOf(ws().working, 'ka')).toEqual(['a1', 'a2'])
    expect(tabsOf(await stored(id!), 'ka')).toEqual(['a1', 'a2'])
    await redo()
    expect(tabsOf(await stored(id!), 'kb')).toEqual(['a2', 'b1'])
    expect(ws().writeFailed).toBe(false)
  })

  it('names each kind of edit plainly', async () => {
    await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    ws().closeTab(tabId)
    const split = ws().splitCell('kb', 'bottom')!
    ws().closeCell(split)
    ws().insertTrack('top')
    ws().insertTrack('left')
    ws().mergeCells('ka', 'kb')
    ws().patchTabConfig('a2', 'calendar', { dateTypes: { due: false, followup: true } })
    ws().changeTabKind('a1', 'trend')
    ws().closeCell('ka')
    expect(undoNames()).toEqual([
      'Added “Notes”',
      'Closed tab “Notes”',
      'Split cell',
      'Closed cell',
      'Inserted row',
      'Inserted column',
      'Merged cells',
      'Changed “Calendar”',
      'Changed “Notes” to Created vs completed',
      'Closed cell (3 tabs)',
    ])
    await settleLayoutWrites()
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
    const tabId = ws().addWidget('pulse', { kind: 'cell', cellId: 'kb' })
    expect(tabs().find((t) => t.id === tabId)).toEqual({ id: tabId, kind: 'pulse', config: { tagIds: [4, 6] } })
    const seeded = ws().addWidget('pulse', { kind: 'cell', cellId: 'kb' }, { tagIds: [5] })
    expect(tabs().find((t) => t.id === seeded)?.config).toEqual({ tagIds: [5] })
    ws().changeTabKind('a1', 'pulse')
    expect(tabs().find((t) => t.id === 'a1')?.config).toEqual({ tagIds: [4, 6] })
  })

  it('split, insert, merge and close: stored at once; undone one by one, newest first', async () => {
    const [id] = await seedAndInit(twoColumns())
    const cellId = ws().splitCell('kb', 'bottom')
    expect(picture(ws().working!)).toEqual(['ka kb', `ka ${cellId}`])
    expect(picture(await stored(id!))).toEqual(['ka kb', `ka ${cellId}`])
    const inserted = ws().insertTrack('top')
    expect(picture(ws().working!)).toEqual([`${inserted} ${inserted}`, 'ka kb', `ka ${cellId}`])
    expect(ws().mergeCells('ka', 'zz')).toBe(false)
    await undo()
    expect(picture(await stored(id!))).toEqual(['ka kb', `ka ${cellId}`])
    await undo()
    expect(picture(await stored(id!))).toEqual(['ka kb'])
    expect(ws().working!.grid.rows.map((t) => t.id)).toEqual(['R'])
    expect(undoNames()).toEqual([])
  })

  it('tab config and Change widget are stored at once; undone, the old config and kind are back', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().patchTabConfig('a2', 'calendar', { dateTypes: { due: false, followup: true } })
    expect(cellOf(await stored(id!), 'ka')!.tabs[1]!.config).toEqual({ dateTypes: { due: false, followup: true } })
    ws().changeTabKind('b1', 'notes')
    expect(cellOf(await stored(id!), 'kb')!.tabs[0]).toEqual({ id: 'b1', kind: 'notes', config: {} })
    ws().patchTabConfig('b1', 'notes', {}, 'Edited notes')
    expect(undoNames().at(-1)).not.toBe('Edited notes') // no change: no step
    await undo()
    expect(cellOf(await stored(id!), 'kb')!.tabs[0]).toEqual(createTab('lens', 'b1'))
    await undo()
    expect(cellOf(await stored(id!), 'ka')!.tabs[1]!.config).toEqual(createTab('calendar', 'a2').config)
  })

  it('an editor’s Save names its own step', async () => {
    await seedAndInit(twoColumns())
    ws().changeTabKind('b1', 'trend')
    ws().patchTabConfig('b1', 'trend', { range: '4w' }, 'Edited trend')
    expect(undoNames()).toEqual(['Changed “List” to Created vs completed', 'Edited trend'])
    await settleLayoutWrites()
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
    await settleLayoutWrites()
  })
})

describe('undo of a structural edit', () => {
  it('keeps the view state of the moment it runs: sizes and active tabs changed since stay', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    await ws().setTrackSizes({ A: 1500, B: 500 })
    await ws().setActiveTab('a2')
    await ws().patchTabViewState('a2', 'calendar', { view: 'month' })
    await undo()
    expect(tabsOf(ws().working, 'kb')).toEqual(['b1'])
    expect(ws().working!.grid.columns.map((c) => c.weight)).toEqual([1500, 500])
    expect(cellOf(ws().working, 'ka')!.activeTabId).toBe('a2')
    expect(cellOf(ws().working, 'ka')!.tabs[1]!.viewState).toEqual({ view: 'month' })
    const row = await stored(id!)
    expect(row.grid.columns.map((c) => c.weight)).toEqual([1500, 500])
    expect(cellOf(row, 'ka')!.activeTabId).toBe('a2')
    // Redo: the tab is back, the sizes stay.
    await ws().setTrackSizes({ A: 1200, B: 800 })
    await redo()
    expect(tabsOf(await stored(id!), 'kb')).toEqual(['b1', tabId])
    expect(ws().working!.grid.columns.map((c) => c.weight)).toEqual([1200, 800])
  })

  it('a split’s undo after a resize of the new track: the old sizes of its axis come back', async () => {
    await seedAndInit(twoColumns('Daily', {}, { cols: [300, 700] }))
    ws().splitCell('ka', 'right')
    const [a, mid] = ws().working!.grid.columns.map((c) => c.id)
    await ws().setTrackSizes({ [a!]: 100, [mid!]: 200 })
    await undo()
    expect(ws().working!.grid.columns.map((c) => [c.id, c.weight])).toEqual([['A', 300], ['B', 700]])
  })

  it('while another layout is open it is refused, naming the layout; it stays on the stack and runs once that layout is open', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    await ws().load(b!)
    await undo()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Open layout “A” to undo: Closed tab “List”.', notice: true })
    expect(undoNames()).toEqual(['Closed tab “List”'])
    expect(tabsOf(await stored(a!), 'kb')).toBeUndefined()
    await ws().load(a!)
    await undo()
    expect(tabsOf(await stored(a!), 'kb')).toEqual(['b1'])
  })

  it('once its layout is gone it says so and drops the step', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    await settleLayoutWrites()
    await ws().load(b!)
    await ws().delete(a!)
    await undo()
    expect(useUndoStore.getState().snackbar?.description).toBe('Can’t undo: Closed tab “List” — its layout is gone.')
    expect(undoNames()).toEqual([])
  })

  it('a divider’s key steps share a merge key: one undo step back to before the first', async () => {
    const kc = cell('kc', [createTab('notes', 'c1')])
    const kd = cell('kd', [createTab('notes', 'd1')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[KA, KB], [kc, kd]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    const before = picture(ws().working!)
    const rowsBefore = ws().working!.grid.rows.length
    const step = async (delta: number, mergeKey?: string) => {
      const part = { ...edgeBetween(ws().working!, 'ka', 'kc')!, to: 1 }
      await ws().moveEdge(part, delta, { sizes: ws().working!.grid.rows.map(() => 400), minPx: () => 20 }, mergeKey ? { mergeKey } : undefined)
    }
    // Off the line (a new line); the steps after it resize that line (view state).
    await step(16, 'divider:ka-kc')
    expect(ws().working!.grid.rows.length).toBe(rowsBefore + 1)
    await step(16, 'divider:ka-kc')
    await step(16, 'divider:ka-kc')
    expect(undoNames()).toEqual(['Moved divider'])
    // An undo step with no snackbar: the table shows the move.
    expect(useUndoStore.getState().snackbar).toBeNull()
    await undo()
    expect(picture(ws().working!)).toEqual(before)
    expect(picture(await stored(id!))).toEqual(before)
    await redo()
    expect(ws().working!.grid.rows.length).toBe(rowsBefore + 1)
    // Another edit: a step of its own.
    ws().splitCell('kd', 'right')
    expect(undoNames()).toEqual(['Moved divider', 'Split cell'])
  })
})

describe('writes run in the order they were made', () => {
  it('a view change made right after an edit lands on top of it, stored and on a reload', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    const switching = ws().setActiveTab(tabId)
    const resizing = ws().setTrackSizes({ A: 1800 })
    await Promise.all([switching, resizing])
    const row = await stored(id!)
    expect(tabsOf(row, 'kb')).toEqual(['b1', tabId])
    expect(cellOf(row, 'kb')!.activeTabId).toBe(tabId)
    expect(row.grid.columns[0]!.weight).toBe(1800)
    await reload()
    expect(cellOf(ws().working, 'kb')!.activeTabId).toBe(tabId)
    expect(ws().working!.grid.columns[0]!.weight).toBe(1800)
  })

  it('a view change made before an edit is in what the edit writes', async () => {
    const [id] = await seedAndInit(twoColumns())
    const switching = ws().setActiveTab('a2')
    ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })
    await switching
    const row = await stored(id!)
    expect(row.cells[0]!.activeTabId).toBe('a2')
    expect(tabsOf(row, 'kb')).toHaveLength(2)
    expect(ws().saved).toEqual(row)
  })
})

describe('a write that fails', () => {
  function failWrites() {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    return vi.spyOn(layoutRepository, 'putAndPrune').mockRejectedValue(new DOMException('full', 'QuotaExceededError'))
  }

  it('keeps the edit on screen, says so and marks the layout; Retry writes it', async () => {
    const [id] = await seedAndInit(twoColumns())
    const put = failWrites()
    ws().closeTab('b1')
    await settleLayoutWrites()
    expect(ws().writeFailed).toBe(true)
    expect(picture(ws().working!)).toEqual(['ka'])
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Couldn\'t save layout "Daily".', notice: true })
    expect(picture(await stored(id!))).toEqual(['ka kb'])
    expect(await ws().retryWrite()).toBe(false)
    put.mockRestore()
    expect(await ws().retryWrite()).toBe(true)
    expect(ws().writeFailed).toBe(false)
    expect(picture(await stored(id!))).toEqual(['ka'])
  })

  it('the next edit writes the whole layout, and clears it', async () => {
    const [id] = await seedAndInit(twoColumns())
    const put = failWrites()
    ws().closeTab('a2')
    await settleLayoutWrites()
    put.mockRestore()
    ws().closeTab('b1')
    await settleLayoutWrites()
    expect(ws().writeFailed).toBe(false)
    expect(tabsOf(await stored(id!), 'ka')).toEqual(['a1'])
    expect(picture(await stored(id!))).toEqual(['ka'])
  })

  it('leaving the layout tries again first; when that fails too, it stays and says so', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    const put = failWrites()
    ws().closeTab('b1')
    await settleLayoutWrites()
    await ws().load(b!)
    expect(ws().activeLayoutId).toBe(a)
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn\'t save layout "A". Retry before leaving it, or its last changes are lost.')
    expect(await ws().createLayout('New')).toBeNull()
    put.mockRestore()
    await ws().load(b!)
    expect(ws().activeLayoutId).toBe(b)
    expect(picture(await stored(a!))).toEqual(['ka'])
  })
})

describe('view state', () => {
  it('active tab / row collapse / tab view state persist at once and are no undo step', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().setActiveTab('a2')
    await ws().setTrackCollapsed('R', true)
    await ws().patchTabViewState('a2', 'calendar', { view: 'month', offset: 3 })
    expect(undoNames()).toEqual([])
    const row = await stored(id!)
    expect(row.cells[0]!.activeTabId).toBe('a2')
    expect(row.grid.rows[0]!.collapsed).toBe(true)
    expect(row.cells[0]!.tabs[1]!.viewState).toEqual({ view: 'month', offset: 3 })
    expect(row.modifiedAt).toEqual(T0)
    await ws().setTrackCollapsed(['R'], false)
    expect('collapsed' in (await stored(id!)).grid.rows[0]!).toBe(false)
  })

  it('a details-width write is view state: stored at once, no undo step; clearing removes it', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().patchTabViewState('b1', 'lens', { detailsWidth: 310 })
    expect(cellOf(await stored(id!), 'kb')!.tabs[0]!.viewState).toEqual({ detailsWidth: 310 })
    await ws().patchTabViewState('b1', 'lens', { detailsWidth: undefined })
    expect(cellOf(await stored(id!), 'kb')!.tabs[0]!.viewState).toEqual({})
    expect(undoNames()).toEqual([])
  })

  // A layout's old lens pick (`lensId`) and a Review widget's saved kind, pick and place: v79 removed
  // them from every stored row (`v79-upgrade.test`), so the layout read has no shim for them.
})

describe('sizes are view state', () => {
  const weights = (l: LayoutBody | null | undefined) => l?.grid.columns.map((c) => c.weight)
  /** ka | kb over R, and a fixed 140px row T across both. */
  const withFixedRow = () => ({ ...twoColumns(), ...grid([[KA, KB], [cell('kt', [createTab('notes', 't1')]), cell('kt', [createTab('notes', 't1')])]], { colIds: ['A', 'B'], rowIds: ['R', 'T'], rows: [1000, { px: 140 }] }) })

  it('a resize is saved at once, no undo step, kept by a reload, nothing kept in the browser', async () => {
    const [id] = await seedAndInit(withFixedRow())
    await ws().setTrackSizes({ A: 1400, B: 600 })
    await ws().setTrackSizes({ T: 230 })
    expect(undoNames()).toEqual([])
    expect(weights(await stored(id!))).toEqual([1400, 600])
    expect((await stored(id!)).grid.rows[1]).toEqual({ id: 'T', px: 230 })
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    await reload()
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
    expect(weights(ws().saved)).toEqual([1000, 1000])
    expect(updateView).not.toHaveBeenCalled()
    expect(weights(await stored(id!))).toEqual([1000, 1000])
    await ws().endResize()
    expect(updateView).toHaveBeenCalledOnce()
    expect(weights(await stored(id!))).toEqual([1400, 600])
    expect((await stored(id!)).grid.rows[1]?.px).toBe(180)
    await ws().endResize()
    expect(updateView).toHaveBeenCalledOnce()
    await reload()
    expect(weights(ws().working)).toEqual([1400, 600])
  })

  it('moveEdge: a whole line is a resize (view state); part of a line a structural edit (an undo step)', async () => {
    // ka kb
    // kc kd
    const kc = cell('kc', [createTab('notes', 'c1')])
    const kd = cell('kd', [createTab('notes', 'd1')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[KA, KB], [kc, kd]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    await ws().moveEdge(wholeLine(ws().working!, 'columns', 1), 100, { sizes: [400, 400] })
    expect(undoNames()).toEqual([])
    expect(weights(await stored(id!))).toEqual([1250, 750])
    // Only the ka / kc part of the row line: it leaves kb / kd's behind.
    const part = { ...edgeBetween(ws().working!, 'ka', 'kc')!, to: 1 }
    await ws().moveEdge(part, 50, { sizes: [400, 400], minPx: () => 20 })
    expect(undoNames()).toEqual(['Moved divider'])
    expect(ws().working!.grid.rows).toHaveLength(3)
    expect((await stored(id!)).grid.rows).toHaveLength(3)
  })

  it('a Numbers-only row: its divider gives it a height (fitPx), saved at once, its weight kept; clearing it lets it fit again', async () => {
    // kn (a Number) | kc (a Number) over R; kb across S.
    const kn = cell('kn', [createTab('number', 'n1')])
    const kc = cell('kc', [createTab('number', 'n2')])
    const [id] = await seedAndInit({ ...twoColumns(), ...grid([[kn, kc], [KB, KB]], { colIds: ['A', 'B'], rowIds: ['R', 'S'] }) })
    await ws().moveEdge(wholeLine(ws().working!, 'rows', 1), 40, { sizes: [76, 600] })
    expect(ws().working!.grid.rows[0]).toEqual({ id: 'R', weight: 1000, fitPx: 116 })
    expect((await stored(id!)).grid.rows[0]).toEqual({ id: 'R', weight: 1000, fitPx: 116 })
    await ws().clearTrackFitPx('R')
    expect(ws().working!.grid.rows[0]).toEqual({ id: 'R', weight: 1000 })
    expect((await stored(id!)).grid.rows[0]).toEqual({ id: 'R', weight: 1000 })
    expect(undoNames()).toEqual([])
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

  it('a new column’s width is saved at once with it', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().addWidget('notes', { kind: 'insert', edge: 'right' })
    const added = weights(ws().working)!
    await ws().setTrackSizes({ A: 2000 })
    expect(weights(await stored(id!))).toEqual([2000, ...added.slice(1)])
    await reload()
    expect(weights(ws().working)).toEqual([2000, ...added.slice(1)])
  })

  it('Duplicate layout: the copy has the sizes; the layout it came from keeps its own', async () => {
    const [orig] = await seedAndInit(twoColumns())
    await ws().setTrackSizes({ A: 1400, B: 600 })
    const copy = await ws().duplicateLayout('Copy')
    expect(weights(await stored(copy!))).toEqual([1400, 600])
    expect(weights(await stored(orig!))).toEqual([1400, 600])
  })
})

describe('layouts', () => {
  it('Duplicate layout opens the copy, after the others; the original stays', async () => {
    const [orig] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    const copy = await ws().duplicateLayout('  Daily copy ')
    expect(copy).not.toBeNull()
    expect(ws()).toMatchObject({ activeLayoutId: copy, writeFailed: false })
    expect(ws().working!.name).toBe('Daily copy')
    expect((await stored(copy!)).cells).toHaveLength(1)
    expect((await stored(orig!)).cells).toHaveLength(1)
    expect(await layoutRepository.getActiveId()).toBe(copy)
    expect(ws().layouts.map((l) => l.name)).toEqual(['Daily', 'Daily copy'])
    expect(await ws().duplicateLayout('   ')).toBeNull()
  })

  it('load switches layouts and stamps lastUsedAt; the open layout’s edits are already stored', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    await ws().load(b!)
    expect(ws()).toMatchObject({ activeLayoutId: b, writeFailed: false })
    expect(ws().working!.cells).toHaveLength(2)
    expect(await layoutRepository.getActiveId()).toBe(b)
    expect((await stored(b!)).lastUsedAt).toBeInstanceOf(Date)
    expect((await stored(a!)).cells).toHaveLength(1)
    await ws().load(999)
    expect(ws().activeLayoutId).toBe(b)
  })

  it('rename is no undo step and changes only the name', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    expect(await ws().rename(id!, 'Morning')).toBe(true)
    expect(ws().working!.name).toBe('Morning')
    expect(ws().working!.cells).toHaveLength(1)
    const row = await stored(id!)
    expect(row.name).toBe('Morning')
    expect(row.cells).toHaveLength(1)
    expect(undoNames()).toEqual(['Closed tab “List”'])
    expect(await ws().rename(id!, '')).toBe(false)
  })

  it('rename with a hue stores both at once; null clears the hue; no hue leaves it', async () => {
    const [id] = await seedAndInit(twoColumns())
    expect(await ws().rename(id!, 'Morning', 'violet')).toBe(true)
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

  it('rename with an icon stores it with the name, no undo step; none leaves it; No icon is stored as none', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    expect(await ws().rename(id!, 'Home', 'green', { kind: 'emoji', emoji: '🏠' })).toBe(true)
    expect(ws().working).toMatchObject({ name: 'Home', hue: 'green', icon: { kind: 'emoji', emoji: '🏠' } })
    expect(ws().layouts.find((l) => l.id === id)?.icon).toEqual({ kind: 'emoji', emoji: '🏠' })
    expect((await stored(id!)).icon).toEqual({ kind: 'emoji', emoji: '🏠' })
    expect(undoNames()).toEqual(['Closed tab “List”'])
    expect(await ws().rename(id!, 'Home 2', 'green')).toBe(true)
    expect((await stored(id!)).icon).toEqual({ kind: 'emoji', emoji: '🏠' })
    expect(await ws().rename(id!, 'Home 2', 'green', { kind: 'none' })).toBe(true)
    expect((await stored(id!)).icon).toEqual({ kind: 'none' })
    expect(ws().working!.icon).toEqual({ kind: 'none' })
    // A later structural edit writes the whole layout: the icon stays.
    ws().splitCell(ws().working!.cells[0]!.id, 'right')
    await vi.waitFor(async () => expect((await stored(id!)).cells.length).toBe(2))
    expect((await stored(id!)).icon).toEqual({ kind: 'none' })
  })

  it('Duplicate layout carries the icon', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().rename(id!, 'Daily', undefined, { kind: 'line', key: 'flag' })
    const copy = await ws().duplicateLayout('Daily copy')
    expect((await stored(copy!)).icon).toEqual({ kind: 'line', key: 'flag' })
    expect(ws().working!.icon).toEqual({ kind: 'line', key: 'flag' })
  })

  it('an undo after a rename keeps the new name', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    await ws().rename(id!, 'Morning')
    await undo()
    expect(await stored(id!)).toMatchObject({ name: 'Morning' })
    expect(picture(await stored(id!))).toEqual(['ka kb'])
  })

  it('createLayout stores an empty layout under its name, after the others, and opens it', async () => {
    const [a] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    const id = await ws().createLayout('  Planning ')
    expect(id).not.toBeNull()
    expect(ws()).toMatchObject({ activeLayoutId: id, writeFailed: false })
    expect(ws().working).toMatchObject({ id, name: 'Planning', ...emptyBody() })
    expect(ws().saved).toEqual(ws().working)
    expect(await stored(id!)).toMatchObject({ name: 'Planning', ...emptyBody(), sortOrder: 2 })
    expect(await layoutRepository.getActiveId()).toBe(id)
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'B', 'Planning'])
    expect((await stored(a!)).cells).toHaveLength(1)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('createLayout refuses an empty name; a failed write stores nothing and says so', async () => {
    const [a] = await seedAndInit(twoColumns('A'))
    expect(await ws().createLayout('   ')).toBeNull()
    vi.spyOn(layoutRepository, 'insert').mockRejectedValueOnce(new Error('quota'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await ws().createLayout('Planning')).toBeNull()
    expect(ws().activeLayoutId).toBe(a)
    expect(await db.layouts.count()).toBe(1)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: `Couldn't create layout "Planning".`, notice: true })
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

describe('an open editor holding changes is asked before the layout is left (cr34 T6, D3)', () => {
  type Answer = 'save' | 'discard' | 'keep'
  const NUMBER = cell('kn', [createTab('number', 'u1')], { activeTabId: 'u1' })
  const withNumber = (name: string): Omit<WorkspaceLayout, 'id'> => ({
    sortOrder: 0, name, createdAt: T0, modifiedAt: T0, ...grid([[NUMBER]], { colIds: ['A'], rowIds: ['R'] }),
  })
  const numberName = (l: LayoutBody | null | undefined) => {
    const tab = l?.cells.flatMap((c) => c.tabs).find((t) => t.id === 'u1')
    return tab?.kind === 'number' ? tab.config.name : undefined
  }

  /**
   * A widget editor open on the Number with a changed name, as the store
   * sees it (`registerOpenEditor`): Save writes the name as the editor's
   * Save does (one config patch) and closes; Discard only closes; Keep
   * editing stays open.
   */
  function openEditor(answer: Answer) {
    let changed = true
    const ask = vi.fn(() => {
      if (answer === 'keep') return Promise.resolve(false)
      if (answer === 'save') ws().patchTabConfig('u1', 'number', { name: 'Saved by the editor' }, 'Edited number “Open”')
      changed = false
      return Promise.resolve(true)
    })
    const off = registerOpenEditor({ changed: () => changed, ask })
    return { ask, off }
  }

  it('Duplicate layout, Save: the copy holds what the editor saved, and so does the original', async () => {
    const [orig] = await seedAndInit(withNumber('Daily'))
    const { ask } = openEditor('save')
    const copy = await ws().duplicateLayout('Daily copy')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(copy).not.toBeNull()
    expect(ws().activeLayoutId).toBe(copy)
    expect(numberName(ws().working)).toBe('Saved by the editor')
    expect(numberName(await stored(copy!))).toBe('Saved by the editor')
    expect(numberName(await stored(orig!))).toBe('Saved by the editor')
  })

  it('Duplicate layout, Discard: the copy is of the layout as stored', async () => {
    const [orig] = await seedAndInit(withNumber('Daily'))
    openEditor('discard')
    const copy = await ws().duplicateLayout('Daily copy')
    expect(copy).not.toBeNull()
    expect(numberName(await stored(copy!))).toBe('Open')
    expect(numberName(await stored(orig!))).toBe('Open')
  })

  it('Duplicate layout, Keep editing: nothing happens', async () => {
    const [orig] = await seedAndInit(withNumber('Daily'))
    const { ask } = openEditor('keep')
    expect(await ws().duplicateLayout('Daily copy')).toBeNull()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ws().activeLayoutId).toBe(orig)
    expect(await db.layouts.count()).toBe(1)
  })

  it.each(['save', 'discard'] as const)('New layout, %s: the new layout opens; the layout left is stored as the answer left it', async (answer) => {
    const [orig] = await seedAndInit(withNumber('Daily'))
    const { ask } = openEditor(answer)
    const id = await ws().createLayout('Planning')
    expect(ask).toHaveBeenCalledTimes(1)
    expect(id).not.toBeNull()
    expect(ws()).toMatchObject({ activeLayoutId: id, writeFailed: false })
    expect(ws().working).toMatchObject({ name: 'Planning', ...emptyBody() })
    expect(numberName(await stored(orig!))).toBe(answer === 'save' ? 'Saved by the editor' : 'Open')
  })

  it('New layout, Keep editing: nothing happens', async () => {
    const [orig] = await seedAndInit(withNumber('Daily'))
    openEditor('keep')
    expect(await ws().createLayout('Planning')).toBeNull()
    expect(ws().activeLayoutId).toBe(orig)
    expect(await db.layouts.count()).toBe(1)
  })

  it.each(['save', 'discard'] as const)('Delete of the open layout, %s: it is deleted and the next one opens', async (answer) => {
    const [a, b] = await seedAndInit(withNumber('A'), twoColumns('B'))
    const { ask } = openEditor(answer)
    expect(await ws().delete(a!)).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    await settleLayoutWrites()
    expect(await db.layouts.get(a!)).toBeUndefined()
    expect(ws().activeLayoutId).toBe(b)
    expect(ws().layouts.map((l) => l.name)).toEqual(['B'])
    expect(ws().writeFailed).toBe(false)
  })

  it('Delete of the open layout, Keep editing: it stays, open and stored', async () => {
    const [a] = await seedAndInit(withNumber('A'), twoColumns('B'))
    openEditor('keep')
    expect(await ws().delete(a!)).toBe(false)
    expect(ws().activeLayoutId).toBe(a)
    expect(await db.layouts.count()).toBe(2)
  })

  it('Delete of another layout asks nothing: the editor’s layout stays on screen', async () => {
    const [a, b] = await seedAndInit(withNumber('A'), twoColumns('B'))
    const { ask } = openEditor('keep')
    expect(await ws().delete(b!)).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect(ws().activeLayoutId).toBe(a)
  })

  it('a layout switch: Keep editing stays; Save switches with the change stored', async () => {
    const [a, b] = await seedAndInit(withNumber('A'), twoColumns('B'))
    const kept = openEditor('keep')
    await ws().load(b!)
    expect(ws().activeLayoutId).toBe(a)
    kept.off()
    openEditor('save')
    await ws().load(b!)
    expect(ws().activeLayoutId).toBe(b)
    expect(numberName(await stored(a!))).toBe('Saved by the editor')
  })
})

describe('an unsaved layout change an older build kept in the browser', () => {
  it('nothing is kept for a reload any more: an edit is stored, the browser keeps nothing', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    await reload()
    expect(picture(ws().working!)).toEqual(['ka'])
    expect(picture(await stored(id!))).toEqual(['ka'])
  })

  it('made against the stored layout: applied once at launch as one undo step, with the snackbar; the key goes', async () => {
    const [id] = await seedAndInit(twoColumns())
    const base = layoutBodyOf(await stored(id!))
    writeLayoutDraft({ kind: 'saved', layoutId: id!, base, body: grid([[KA]], { colIds: ['A'], rowIds: ['R'] }) })
    await reload()
    expect(picture(ws().working!)).toEqual(['ka'])
    expect(picture(await stored(id!))).toEqual(['ka'])
    expect(undoNames()).toEqual(['Applied unsaved changes to layout “Daily”'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Applied unsaved changes to layout “Daily”')
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    await undo()
    expect(picture(await stored(id!))).toEqual(['ka kb'])
    // Once: a second reload finds nothing to apply.
    await reload()
    expect(undoNames()).toEqual([])
    expect(picture(ws().working!)).toEqual(['ka kb'])
  })

  it('a draft for a resize alone: the sizes are saved, no undo step', async () => {
    const [id] = await seedAndInit(twoColumns())
    const base = layoutBodyOf((await stored(id!)))
    const body: LayoutBody = { ...base, grid: { ...base.grid, columns: base.grid.columns.map((c, i) => ({ ...c, weight: i === 0 ? 1500 : 500 })) } }
    writeLayoutDraft({ kind: 'saved', layoutId: id!, base, body })
    await reload()
    expect(ws().working!.grid.columns.map((c) => c.weight)).toEqual([1500, 500])
    expect((await stored(id!)).grid.columns.map((c) => c.weight)).toEqual([1500, 500])
    expect(undoNames()).toEqual([])
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('a draft of a layout that changed since is dropped, and the key goes', async () => {
    const [a] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    const base = layoutBodyOf(await stored(a!))
    writeLayoutDraft({ kind: 'saved', layoutId: a!, base, body: grid([[KB]], { colIds: ['A'], rowIds: ['R'] }) })
    // Elsewhere: the stored layout changed under the draft.
    await db.layouts.update(a!, { ...grid([[KA]]) })
    await reload()
    expect(picture(ws().working!)).toEqual(['ka'])
    expect(undoNames()).toEqual([])
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('a kept new layout that shows no list becomes a stored layout and opens; one that shows a list is dropped (every list is a stored layout’s)', async () => {
    const listId = await db.listDefinitions.add({
      name: 'Inbox', sortOrder: 0, sort: 'manual', grouping: 'none', owner: { layoutId: 1 },
      membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {} } },
    } as never) as number
    const [a] = await seedAndInit(twoColumns('A'))
    await useListDefinitionStore.getState().load()
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: grid([[cell('kn', [createTab('notes', 'n1')])]]) })
    await reload()
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'Untitled layout'])
    expect(ws().working).toMatchObject({ name: 'Untitled layout' })
    expect(ws().activeLayoutId).not.toBe(a)
    expect((await stored(ws().activeLayoutId!)).cells).toHaveLength(1)
    expect(useUndoStore.getState().snackbar?.description).toBe('Kept the unsaved new layout “Untitled layout”.')
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()

    await ws().load(a!)
    writeLayoutDraft({ kind: 'new', name: 'With a list', body: grid([[cell('kl', [createTab('lens', 'l1', { listDefinitionId: listId })])]]) })
    await reload()
    expect(ws().activeLayoutId).toBe(a)
    expect(ws().layouts).toHaveLength(2)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })
})
