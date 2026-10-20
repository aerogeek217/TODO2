import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createTab, UNSAVED_LAYOUT_ID, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { writeLayoutDraft } from '../../data/draft-storage'
import { useUndoStore } from '../../stores/undo-store'
import type { LayoutBody } from '../../models/workspace-layout'

const T0 = new Date('2026-09-01T09:00:00.000Z')

/** [A: (a1 a2)] [B: (b1)] */
function twoColumns(name = 'Daily', extra: Partial<WorkspaceLayout> = {}): Omit<WorkspaceLayout, 'id'> {
  return {
    sortOrder: 0, name,
    createdAt: T0,
    modifiedAt: T0,
    columns: [
      { id: 'A', weight: 1, cells: [{ id: 'ka', weight: 1, activeTabId: 'a1', tabs: [createTab('notes', 'a1'), createTab('calendar', 'a2')] }] },
      { id: 'B', weight: 1, cells: [{ id: 'kb', weight: 1, activeTabId: 'b1', tabs: [createTab('eisenhower', 'b1')] }] },
    ],
    ...extra,
  }
}

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
async function openKeptNewLayout(body: LayoutBody = { columns: [] }, name = 'Untitled layout', listNames: Record<string, string> = {}) {
  writeLayoutDraft({ kind: 'new', name, body, listNames })
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
    expect(layouts[0]).toMatchObject({ name: 'Default', columns: [] })
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
    const tabId = ws().addWidget('lens', { kind: 'column-edge', columnId: 'B', edge: 'right' }, { listDefinitionId: 7 })
    expect(tabId).not.toBeNull()
    expect(ws().isDirty).toBe(true)
    expect((await stored(id!)).columns).toHaveLength(2)

    await ws().save()
    expect(ws().isDirty).toBe(false)
    const saved = await stored(id!)
    expect(saved.columns).toHaveLength(3)
    expect(saved.columns[2]!.cells[0]!.tabs[0]).toEqual({ id: tabId, kind: 'lens', config: { listDefinitionId: 7 } })
    expect(saved.modifiedAt.getTime()).toBeGreaterThan(T0.getTime())

    ws().closeTab(tabId!)
    expect(ws().working!.columns).toHaveLength(2)
    ws().discard()
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.columns).toHaveLength(3)
  })

  it('a stored layout’s bands open with it and survive column edits, save and save as', async () => {
    const top = { id: 'tb', height: 140, activeTabId: 'top2', tabs: [createTab('dashboard', 'top1'), createTab('notes', 'top2')] }
    const bottom = { id: 'bb', height: 160, collapsed: true, tabs: [createTab('calendar', 'bot1')] }
    const [id] = await seedAndInit(twoColumns('Daily', { top, bottom }))
    expect(ws().working).toMatchObject({ top, bottom })
    expect(ws().isDirty).toBe(false)
    ws().addWidget('notes', { kind: 'column-edge', columnId: 'B', edge: 'right' })
    expect(ws().isDirty).toBe(true)
    await ws().save()
    expect((await stored(id!)).columns).toHaveLength(3)
    expect(await stored(id!)).toMatchObject({ top, bottom })
    const copy = await ws().saveAs('Copy')
    expect(await stored(copy!)).toMatchObject({ top, bottom })
  })

  it('a band made, resized, merged into or closed is a layout change; its collapse and active tab are view state', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().movePanel('kb', { kind: 'new-band', edge: 'top' })
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.top?.tabs.map((t) => t.id)).toEqual(['b1'])
    expect(ws().working!.columns.map((c) => c.id)).toEqual(['A'])
    ws().discard()
    expect(ws().working!.top).toBeUndefined()

    const top = { id: 'tb', height: 140, tabs: [createTab('dashboard', 'top1'), createTab('notes', 'top2')] }
    await db.layouts.update(id!, { top })
    await ws().load(id!)
    expect(ws().isDirty).toBe(false)
    ws().setBandHeight('top', 220)
    expect(ws().isDirty).toBe(true)
    ws().setBandHeight('top', 140)
    expect(ws().isDirty).toBe(false)
    await ws().setCellCollapsed('tb', true)
    await ws().setActiveTab('top2')
    expect(ws().isDirty).toBe(false)
    expect(await stored(id!)).toMatchObject({ top: { collapsed: true, activeTabId: 'top2', height: 140 } })
    ws().moveTab('a1', { kind: 'band', edge: 'top' })
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.top?.tabs.map((t) => t.id)).toEqual(['top1', 'top2', 'a1'])
    ws().closeCell('tb')
    expect(ws().working!.top).toBeUndefined()
    await ws().save()
    expect((await stored(id!)).top).toBeUndefined()
  })

  it('split / close cell / resize / tab config / change kind are layout changes', async () => {
    await seedAndInit(twoColumns())
    const cellId = ws().splitCell('kb', 'below')
    expect(cellId).not.toBeNull()
    expect(ws().isDirty).toBe(true)
    ws().closeCell(cellId!)
    expect(ws().isDirty).toBe(false)
    ws().setColumnWeights({ A: 1.4, B: 0.6 })
    expect(ws().isDirty).toBe(true)
    ws().discard()
    ws().patchTabConfig('a2', 'calendar', { dateTypes: { due: false, followup: true } })
    expect(ws().isDirty).toBe(true)
    ws().discard()
    ws().changeTabKind('b1', 'notes')
    expect(ws().working!.columns[1]!.cells[0]!.tabs[0]).toEqual({ id: 'b1', kind: 'notes', config: {} })
    expect(ws().isDirty).toBe(true)
  })

  it('a dashboard tab: changing to it and editing its config are layout changes', async () => {
    await seedAndInit(twoColumns())
    ws().changeTabKind('b1', 'dashboard')
    expect(ws().working!.columns[1]!.cells[0]!.tabs[0]).toEqual(createTab('dashboard', 'b1'))
    expect(ws().isDirty).toBe(true)
    await ws().save()
    expect(ws().isDirty).toBe(false)
    // Hiding a section (what Customize writes).
    ws().patchTabConfig('b1', 'dashboard', { sections: [{ id: 'hot' }, { id: 'people' }] })
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
  it('active tab / collapse / tab view state persist at once and never mark the layout dirty', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().setActiveTab('a2')
    await ws().setCellCollapsed('kb', true)
    await ws().patchTabViewState('a2', 'calendar', { view: 'month', offset: 3 })
    expect(ws().isDirty).toBe(false)
    const row = await stored(id!)
    expect(row.columns[0]!.cells[0]!.activeTabId).toBe('a2')
    expect(row.columns[1]!.cells[0]!.collapsed).toBe(true)
    expect(row.columns[0]!.cells[0]!.tabs[1]!.viewState).toEqual({ view: 'month', offset: 3 })
    expect(row.modifiedAt).toEqual(T0)
  })

  it('a details-width write is view state: stored at once, never dirty; clearing removes it', async () => {
    const [id] = await seedAndInit(twoColumns())
    await ws().patchTabViewState('b1', 'eisenhower', { detailsWidth: 310 })
    expect(ws().isDirty).toBe(false)
    expect((await stored(id!)).columns[1]!.cells[0]!.tabs[0]!.viewState).toEqual({ detailsWidth: 310 })
    await ws().patchTabViewState('b1', 'eisenhower', { detailsWidth: undefined })
    expect(ws().isDirty).toBe(false)
    expect((await stored(id!)).columns[1]!.cells[0]!.tabs[0]!.viewState).toEqual({})
  })

  it('with unsaved changes: view state still reaches the stored layout, structure does not', async () => {
    const [id] = await seedAndInit(twoColumns())
    const tabId = ws().addWidget('notes', { kind: 'cell', cellId: 'kb' })!
    await ws().patchTabViewState('a2', 'calendar', { offset: -1 })
    await ws().setActiveTab(tabId) // only exists in the working copy
    expect(ws().isDirty).toBe(true)
    const row = await stored(id!)
    expect(row.columns[0]!.cells[0]!.tabs[1]!.viewState).toEqual({ offset: -1 })
    expect(row.columns[1]!.cells[0]!.tabs.map((t) => t.id)).toEqual(['b1'])
    expect(row.columns[1]!.cells[0]!.activeTabId).toBe('b1')
    ws().discard()
    expect(ws().working!.columns[0]!.cells[0]!.tabs[1]!.viewState).toEqual({ offset: -1 })
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
    expect((await stored(copy!)).columns).toHaveLength(1)
    expect((await stored(orig!)).columns).toHaveLength(2)
    expect(await layoutRepository.getActiveId()).toBe(copy)
    expect(ws().layouts.map((l) => l.name)).toEqual(['Daily', 'Daily copy'])
    expect(await ws().saveAs('   ')).toBeNull()
  })

  it('load switches layouts (dropping the working copy) and stamps lastUsedAt', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    await ws().load(b!)
    expect(ws()).toMatchObject({ activeLayoutId: b, isDirty: false })
    expect(ws().working!.columns).toHaveLength(2)
    expect(await layoutRepository.getActiveId()).toBe(b)
    expect((await stored(b!)).lastUsedAt).toBeInstanceOf(Date)
    expect((await stored(a!)).columns).toHaveLength(2)
    await ws().load(999)
    expect(ws().activeLayoutId).toBe(b)
  })

  it('rename never marks dirty and keeps unsaved edits', async () => {
    const [id] = await seedAndInit(twoColumns())
    ws().closeTab('b1')
    expect(await ws().rename(id!, 'Morning')).toBe(true)
    expect(ws()).toMatchObject({ isDirty: true })
    expect(ws().working!.name).toBe('Morning')
    expect(ws().working!.columns).toHaveLength(1)
    const row = await stored(id!)
    expect(row.name).toBe('Morning')
    expect(row.columns).toHaveLength(2)
    expect(await ws().rename(id!, '')).toBe(false)
  })

  it('createLayout stores an empty layout under its name, after the others, and opens it', async () => {
    const [a] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    const id = await ws().createLayout('  Planning ')
    expect(id).not.toBeNull()
    expect(ws()).toMatchObject({ activeLayoutId: id, isDirty: false, previousLayoutId: null })
    expect(ws().working).toMatchObject({ id, name: 'Planning', columns: [] })
    expect(ws().saved).toEqual(ws().working)
    expect(await stored(id!)).toMatchObject({ name: 'Planning', columns: [], sortOrder: 2 })
    expect(await layoutRepository.getActiveId()).toBe(id)
    expect(ws().layouts.map((l) => l.name)).toEqual(['A', 'B', 'Planning'])
    // The edit made before it was dropped (callers ask first); nothing kept.
    expect((await stored(a!)).columns).toHaveLength(2)
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
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID, name: 'Untitled layout', columns: [] })
    expect(await db.layouts.count()).toBe(1)
    ws().addWidget('notes', { kind: 'layout' })
    expect(ws().working!.columns).toHaveLength(1)
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
    expect((await stored(id!)).columns).toHaveLength(1)
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
    expect(ws().working!.columns.map((c) => c.id)).toEqual(['A'])
    expect((await stored(id!)).columns).toHaveLength(2)
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
    expect(ws().working!.columns[0]!.cells[0]!.activeTabId).toBe('a1')
  })

  it('band edits come back after a reload, still unsaved; a band changed in the stored layout drops the draft', async () => {
    const top = { id: 'tb', height: 140, tabs: [createTab('dashboard', 'top1')] }
    const [id] = await seedAndInit(twoColumns('Daily', { top }))
    ws().movePanel('kb', { kind: 'new-band', edge: 'bottom' })
    ws().setBandHeight('top', 200)
    await reload()
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.top?.height).toBe(200)
    expect(ws().working!.bottom?.tabs.map((t) => t.id)).toEqual(['b1'])
    expect((await stored(id!)).bottom).toBeUndefined()
    // A draft that removed the top band comes back without it.
    ws().closeCell('tb')
    await reload()
    expect(ws().working!.top).toBeUndefined()
    // Elsewhere: the stored layout's band changed under the draft.
    await db.layouts.update(id!, { top: { ...top, height: 90 } })
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(ws().working!.top?.height).toBe(90)
  })

  it('the frames of a divider drag (live resizes) keep nothing until its end keeps the result once', async () => {
    await seedAndInit(twoColumns('Daily', { top: { id: 'tb', height: 140, tabs: [createTab('notes', 'top1')] } }))
    ws().setColumnWeights({ A: 1.2, B: 0.8 }, { live: true })
    ws().setColumnWeights({ A: 1.4, B: 0.6 }, { live: true })
    ws().setBandHeight('top', 180, { live: true })
    expect(ws().isDirty).toBe(true)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
    ws().keepLayoutDraft()
    await reload()
    expect(ws().isDirty).toBe(true)
    expect(ws().working!.columns.map((c) => c.weight)).toEqual([1.4, 0.6])
    expect(ws().working!.top?.height).toBe(180)
  })

  it('a kept new layout with a band comes back with it', async () => {
    await seedAndInit(twoColumns())
    await openKeptNewLayout()
    ws().addWidget('notes', { kind: 'new-band', edge: 'top' })
    await reload()
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID, columns: [] })
    expect(ws().working!.top?.tabs).toHaveLength(1)
  })

  it('a kept draft of a layout that changed since is dropped', async () => {
    const [a, b] = await seedAndInit(twoColumns('A'), twoColumns('B'))
    ws().closeTab('b1')
    // Elsewhere: the stored layout changed under the draft.
    await db.layouts.update(a!, { columns: (await stored(b!)).columns.slice(0, 1) })
    await reload()
    expect(ws().isDirty).toBe(false)
    expect(localStorage.getItem('todo2-unsaved-layout')).toBeNull()
  })

  it('a kept new layout comes back new and unsaved; its lists must still be the same lists', async () => {
    const listId = await db.listDefinitions.add({
      name: 'Inbox', sortOrder: 0, sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {} } },
    } as never) as number
    const [a] = await seedAndInit(twoColumns('A'))
    await useListDefinitionStore.getState().load()
    await openKeptNewLayout()
    ws().addWidget('lens', { kind: 'layout' }, { listDefinitionId: listId })
    await reload()
    expect(ws()).toMatchObject({ saved: null, isDirty: true, activeLayoutId: null, previousLayoutId: a })
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID, name: 'Untitled layout' })
    expect(ws().working!.columns).toHaveLength(1)

    // The list it shows is another list now: dropped.
    await db.listDefinitions.update(listId, { name: 'Someone else’s' })
    useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
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
    expect(ws().working!.columns[0]!.cells[0]!.tabs[0]).toMatchObject({ kind: 'eisenhower', config: {} })

    await db.listDefinitions.update(listId, { name: 'Someone else’s' })
    useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
    await reload()
    expect(ws()).toMatchObject({ saved: null, isDirty: true, activeLayoutId: null })
    expect(ws().working).toMatchObject({ id: UNSAVED_LAYOUT_ID })
  })
})
