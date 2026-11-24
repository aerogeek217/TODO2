import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LayoutBody, type PersistedWorkspaceLayout, type WorkspaceLayout } from '../../models/workspace-layout'
import { emptyPredicate } from '../../models/filter-predicate'
import { isLayoutEditStep, layoutEditChanged, listsHeldByEdit, settleLayoutWrites, useWorkspaceStore } from '../../stores/workspace-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { useUIStore } from '../../stores/ui-store'
import { afterLeavingEditors, registerOpenEditor } from '../../stores/editor-leave'
import { runShortcutCommand } from '../../services/keyboard-shortcuts'
import { refreshAllStores } from '../../services/refresh-all'
import { layoutListRefs } from '../../utils/workspace-layout-lists'
import { resetDb } from '../helpers'
import { cell, grid, freshNumberTab, numberWidgetId } from '../helpers/layout-builders'

/**
 * The layout edit mode (layout edit mode E1): while it is on, `working` is a
 * draft and `saved` the layout as stored. Edits, resizes and view state
 * change only the draft and write nothing; Done commits it as one undo
 * step; Cancel puts the stored layout back and offers Restore; leaving the
 * layout asks; layout undo, renames, Retry and the layouts' order wait.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
const snackbar = () => useUndoStore.getState().snackbar
const prompts = () => useUIStore.getState().confirmPrompts
const answer = async (a: 'confirm' | 'discard' | 'cancel') => {
  useUIStore.getState().answerConfirmation(a)
  await settle()
}
/** Lets the store's awaits run (Dexie, the leave question). */
async function settle() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  await settleLayoutWrites()
}

const KA = cell('ka', [createTab('notes', 'a1'), createTab('calendar', 'a2')], { activeTabId: 'a1' })
const KB = cell('kb', [freshNumberTab('b1')], { activeTabId: numberWidgetId('b1') })

function twoColumns(name = 'Daily'): Omit<WorkspaceLayout, 'id'> {
  return { sortOrder: 0, name, createdAt: T0, modifiedAt: T0, ...grid([[KA, KB]], { colIds: ['A', 'B'], rowIds: ['R'] }) }
}

async function seed(...layouts: Array<Omit<WorkspaceLayout, 'id'>>): Promise<number[]> {
  const ids: number[] = []
  for (const l of layouts) ids.push(await layoutRepository.insert(l))
  if (ids[0] !== undefined) await layoutRepository.setActiveId(ids[0])
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
  return ids
}

async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  await settleLayoutWrites()
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

const tabsOf = (l: LayoutBody | null | undefined, cellId: string) => l?.cells.find((c) => c.id === cellId)?.tabs.map((t) => t.id)
const storedListIds = async () => (await db.listDefinitions.toArray()).map((d) => d.id)

/** A list made in the mode, as `createListAndTab` makes it: stored, noted, then shown in a new tab of cell `cellId`. */
async function addListInMode(layoutId: number, cellId: string): Promise<number> {
  const id = await useListDefinitionStore.getState().add({
    name: 'New list', sort: 'manual', grouping: 'none',
    membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId },
  })
  ws().noteEditList(id)
  ws().addWidget('lens', { kind: 'cell', cellId }, { listDefinitionId: id })
  return id
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
})

describe('entering', () => {
  it('opens on the open layout, the cell it came from selected; the snackbar and the widget popup close', async () => {
    await seed(twoColumns())
    useUndoStore.getState().notify('Something')
    useUIStore.getState().setWidgetPopup({ kind: 'tab', tabId: 'a1' })
    expect(await ws().enterEdit({ cellId: 'kb' })).toBe(true)
    expect(ws().editing).toMatchObject({ layoutId: ws().saved?.id, selectedCellId: 'kb', undo: [], redo: [] })
    expect(snackbar()).toBeNull()
    expect(useUIStore.getState().widgetPopup).toBeNull()
  })

  it('an open editor holding changes asks first; Keep editing opens nothing', async () => {
    await seed(twoColumns())
    const ask = vi.fn(() => Promise.resolve(false))
    registerOpenEditor({ changed: () => true, ask })
    expect(await ws().enterEdit()).toBe(false)
    expect(ask).toHaveBeenCalledOnce()
    expect(ws().editing).toBeNull()
  })
})

describe('the draft', () => {
  it('edits change only the draft: nothing written, no global undo step, a step of the mode’s own', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const newCell = ws().splitCell('kb', 'bottom')
    ws().moveTab('a2', { kind: 'cell', cellId: 'kb' })
    expect(newCell).not.toBeNull()
    expect(ws().working?.cells).toHaveLength(3)
    expect(ws().saved?.cells).toHaveLength(2)
    expect(tabsOf(ws().working, 'kb')).toEqual([numberWidgetId('b1'), 'a2'])
    expect(undoNames()).toEqual([])
    expect(ws().editing?.undo).toHaveLength(2)
    expect((await stored(id!)).cells).toHaveLength(2)
    expect(layoutEditChanged(ws())).toBe(true)
  })

  it('resizes and view state change only the draft and write nothing', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    await ws().setActiveTab('a2')
    await ws().setTrackSizes({ A: 700, B: 300 })
    await ws().setTrackCollapsed('R', true)
    expect(ws().working?.cells.find((c) => c.id === 'ka')?.activeTabId).toBe('a2')
    expect(ws().saved?.cells.find((c) => c.id === 'ka')?.activeTabId).toBe('a1')
    const row = await stored(id!)
    expect(row.cells.find((c) => c.id === 'ka')?.activeTabId).toBe('a1')
    expect(row.grid.columns.map((t) => t.weight)).toEqual(ws().saved?.grid.columns.map((t) => t.weight))
    expect(row.grid.rows[0]?.collapsed).toBeUndefined()
    // View state isn't a step of the mode's undo.
    expect(ws().editing?.undo).toHaveLength(0)
    expect(layoutEditChanged(ws())).toBe(true)
  })

  it('the mode’s undo and redo step its edits; with none left they do nothing', async () => {
    await seed(twoColumns())
    await ws().enterEdit()
    ws().undoEdit()
    expect(ws().working?.cells).toHaveLength(2)
    ws().splitCell('kb', 'right')
    ws().closeCell('ka')
    expect(ws().editing?.undo).toHaveLength(2)
    ws().undoEdit()
    expect(ws().working?.cells.map((c) => c.id)).toContain('ka')
    ws().undoEdit()
    expect(ws().working?.cells).toHaveLength(2)
    ws().undoEdit()
    expect(ws().working?.cells).toHaveLength(2)
    ws().redoEdit()
    expect(ws().working?.cells).toHaveLength(3)
    expect(ws().editing?.redo).toHaveLength(1)
    // A new edit clears the redo steps.
    ws().moveTab('a2', { kind: 'cell', cellId: 'kb' })
    expect(ws().editing?.redo).toHaveLength(0)
  })

  it('undo / redo shortcuts (and the palette’s Undo) step the mode; with its stack empty, not a task step behind it', async () => {
    await seed(twoColumns())
    const taskUndo = vi.fn()
    useUndoStore.getState().push({ description: 'Completed task', undo: taskUndo, redo: () => {} })
    await ws().enterEdit()
    const callbacks = { openPalette: () => {}, closePalette: () => {}, openSettings: () => {} }
    await runShortcutCommand('undo', callbacks)
    expect(taskUndo).not.toHaveBeenCalled()
    expect(undoNames()).toEqual(['Completed task'])
    ws().splitCell('kb', 'right')
    await runShortcutCommand('undo', callbacks)
    expect(ws().working?.cells).toHaveLength(2)
    await runShortcutCommand('redo', callbacks)
    expect(ws().working?.cells).toHaveLength(3)
    expect(taskUndo).not.toHaveBeenCalled()
  })
})

describe('Done', () => {
  it('commits the draft as one write and one undo step; its Undo puts the layout back', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    ws().splitCell('kb', 'bottom')
    ws().moveTab('a2', { kind: 'cell', cellId: 'kb' })
    expect(await ws().finishEdit()).toBe(true)
    expect(ws().editing).toBeNull()
    expect(undoNames()).toEqual(['Edited layout “Daily”'])
    expect(isLayoutEditStep(useUndoStore.getState().undoStack[0]!)).toBe(true)
    expect(snackbar()?.description).toBe('Edited layout “Daily”')
    expect((await stored(id!)).cells).toHaveLength(3)
    expect(ws().saved).toBe(ws().working)

    await useUndoStore.getState().undo()
    expect(ws().working?.cells).toHaveLength(2)
    expect(tabsOf(await stored(id!), 'ka')).toEqual(['a1', 'a2'])
  })

  it('a list the draft dropped is deleted with the write and its Undo brings it back', async () => {
    const [id] = await seed(twoColumns())
    const list = await useListDefinitionStore.getState().add({
      name: 'Inbox', sort: 'manual', grouping: 'none',
      membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: id! },
    })
    ws().addWidget('lens', { kind: 'cell', cellId: 'ka' }, { listDefinitionId: list })
    await settleLayoutWrites()
    await ws().enterEdit()
    ws().closeCell('ka')
    expect(await storedListIds()).toContain(list)
    await ws().finishEdit()
    await settleLayoutWrites()
    expect(await storedListIds()).not.toContain(list)
    await useUndoStore.getState().undo()
    await settleLayoutWrites()
    expect(await storedListIds()).toContain(list)
    expect(layoutListRefs(await stored(id!)).has(list)).toBe(true)
  })

  it('only view state changed: written as view state, no undo step', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    await ws().setActiveTab('a2')
    await ws().finishEdit()
    expect(undoNames()).toEqual([])
    expect((await stored(id!)).cells.find((c) => c.id === 'ka')?.activeTabId).toBe('a2')
  })

  it('nothing changed: it just leaves', async () => {
    const [id] = await seed(twoColumns())
    const before = await stored(id!)
    await ws().enterEdit()
    await ws().finishEdit()
    expect(ws().editing).toBeNull()
    expect(undoNames()).toEqual([])
    expect(await stored(id!)).toEqual(before)
  })

  it('a list made in the mode and then undone there is deleted; one the draft shows is kept', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const dropped = await addListInMode(id!, 'ka')
    ws().undoEdit()
    const kept = await addListInMode(id!, 'kb')
    await ws().finishEdit()
    await settleLayoutWrites()
    const lists = await storedListIds()
    expect(lists).not.toContain(dropped)
    expect(lists).toContain(kept)
    // Its Undo doesn't bring back the list no layout ever showed.
    await useUndoStore.getState().undo()
    await settleLayoutWrites()
    expect(await storedListIds()).not.toContain(dropped)
  })
})

describe('Cancel', () => {
  it('puts the stored layout back and offers Restore, which brings back the draft and its undo steps', async () => {
    await seed(twoColumns())
    await ws().enterEdit({ cellId: 'ka' })
    ws().splitCell('kb', 'bottom')
    const draft = ws().working
    ws().cancelEdit()
    expect(ws().editing).toBeNull()
    expect(ws().working).toBe(ws().saved)
    expect(ws().working?.cells).toHaveLength(2)
    expect(snackbar()).toMatchObject({ description: 'Layout changes discarded', notice: true, action: { label: 'Restore' } })
    expect(prompts()).toHaveLength(0)

    snackbar()?.action?.run()
    useUndoStore.getState().dismissSnackbar()
    await settle()
    expect(ws().editing).toMatchObject({ selectedCellId: 'ka' })
    expect(ws().editing?.undo).toHaveLength(1)
    expect(ws().working?.cells).toEqual(draft?.cells)
    ws().undoEdit()
    expect(ws().working?.cells).toHaveLength(2)
  })

  it('with nothing changed it just leaves, offering nothing', async () => {
    await seed(twoColumns())
    await ws().enterEdit()
    ws().cancelEdit()
    expect(ws().editing).toBeNull()
    expect(snackbar()).toBeNull()
  })

  it('the lists the session made are deleted only once the offer is gone without Restore', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const list = await addListInMode(id!, 'ka')
    ws().cancelEdit()
    await settle()
    expect(await storedListIds()).toContain(list)
    useUndoStore.getState().dismissSnackbar()
    await settle()
    expect(await storedListIds()).not.toContain(list)
  })

  it('no chooser offers a list the session made while nothing shows it: undone in the mode, or held by Cancel’s offer', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const list = await addListInMode(id!, 'ka')
    expect(listsHeldByEdit(ws())).toEqual([])
    ws().undoEdit()
    expect(listsHeldByEdit(ws())).toEqual([list])
    ws().redoEdit()
    expect(listsHeldByEdit(ws())).toEqual([])
    ws().cancelEdit()
    expect(listsHeldByEdit(ws())).toEqual([list])
    // Restore: shown by the draft again, so offered.
    snackbar()?.action?.run()
    await settle()
    expect(ws().editing).not.toBeNull()
    expect(listsHeldByEdit(ws())).toEqual([])
    // Cancel again; the offer gone, the list deleted and no longer held.
    ws().cancelEdit()
    expect(listsHeldByEdit(ws())).toEqual([list])
    useUndoStore.getState().dismissSnackbar()
    await settle()
    expect(listsHeldByEdit(ws())).toEqual([])
    expect(await storedListIds()).not.toContain(list)
  })

  it('Restore keeps the lists the session made', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const list = await addListInMode(id!, 'ka')
    ws().cancelEdit()
    snackbar()?.action?.run()
    useUndoStore.getState().dismissSnackbar()
    await settle()
    expect(await storedListIds()).toContain(list)
    expect(ws().editing?.createdLists).toEqual([list])
    expect(layoutListRefs(ws().working!).has(list)).toBe(true)
  })

  it('another snackbar replacing the offer ends it: the lists go', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const list = await addListInMode(id!, 'ka')
    ws().cancelEdit()
    useUndoStore.getState().notify('Something else')
    await settle()
    expect(await storedListIds()).not.toContain(list)
  })

  it('the leave question’s Discard deletes them at once', async () => {
    const [id, other] = await seed(twoColumns(), twoColumns('Other'))
    await ws().enterEdit()
    const list = await addListInMode(id!, 'ka')
    const switching = ws().load(other!)
    await settle()
    expect(prompts()).toHaveLength(1)
    await answer('discard')
    await switching
    await settle()
    expect(ws().activeLayoutId).toBe(other)
    expect(ws().editing).toBeNull()
    expect(await storedListIds()).not.toContain(list)
  })
})

describe('while editing', () => {
  it('global layout undo steps are refused, the step kept; a task step still runs from the snackbar', async () => {
    await seed(twoColumns())
    ws().closeTab('a2')
    await ws().enterEdit()
    await useUndoStore.getState().undo()
    expect(snackbar()?.description).toBe('Finish editing the layout to undo: Removed “Calendar”.')
    expect(undoNames()).toEqual(['Removed “Calendar”'])
    expect(tabsOf(ws().saved, 'ka')).toEqual(['a1'])
  })

  it('a rename, Retry and the layouts’ order are refused', async () => {
    const [id, other] = await seed(twoColumns(), twoColumns('Other'))
    await ws().enterEdit()
    expect(await ws().rename(id!, 'Renamed')).toBe(false)
    expect(snackbar()?.description).toBe('Finish editing the layout first.')
    expect((await stored(id!)).name).toBe('Daily')
    expect(await ws().moveLayout(other!, 0)).toBe(false)
    expect(ws().layouts.map((l) => l.name)).toEqual(['Daily', 'Other'])
    useWorkspaceStore.setState({ writeFailed: true })
    expect(await ws().retryWrite()).toBe(false)
  })

  it('actions inside the mode don’t ask it: the cell checks pass it by', async () => {
    await seed(twoColumns())
    await ws().enterEdit()
    ws().splitCell('kb', 'right')
    const run = vi.fn()
    afterLeavingEditors(run)
    expect(run).toHaveBeenCalledOnce()
    expect(prompts()).toHaveLength(0)
  })
})

describe('leaving the layout', () => {
  it('a layout switch with changes asks: Keep editing stays; Save commits then switches', async () => {
    const [id, other] = await seed(twoColumns(), twoColumns('Other'))
    await ws().enterEdit()
    ws().splitCell('kb', 'right')
    let switching = ws().load(other!)
    await settle()
    expect(prompts()[0]).toMatchObject({ title: 'Save changes to layout “Daily”?', confirmLabel: 'Save', discardLabel: 'Discard', cancelLabel: 'Keep editing' })
    await answer('cancel')
    await switching
    expect(ws().activeLayoutId).toBe(id)
    expect(ws().editing).not.toBeNull()

    switching = ws().load(other!)
    await settle()
    await answer('confirm')
    await switching
    expect(ws().activeLayoutId).toBe(other)
    expect(ws().editing).toBeNull()
    expect((await stored(id!)).cells).toHaveLength(3)
    expect(undoNames()).toEqual(['Edited layout “Daily”'])
  })

  it('a layout switch with no changes asks nothing and leaves the mode', async () => {
    const [, other] = await seed(twoColumns(), twoColumns('Other'))
    await ws().enterEdit()
    await ws().load(other!)
    expect(prompts()).toHaveLength(0)
    expect(ws().activeLayoutId).toBe(other)
    expect(ws().editing).toBeNull()
  })

  it('Settings asks with changes; without, it opens and the mode closes', async () => {
    await seed(twoColumns())
    await ws().enterEdit()
    ws().splitCell('kb', 'right')
    useUIStore.getState().openSettings()
    expect(useUIStore.getState().settingsOpen).toBe(false)
    expect(prompts()).toHaveLength(1)
    await answer('cancel')
    expect(useUIStore.getState().settingsOpen).toBe(false)
    expect(ws().editing).not.toBeNull()

    ws().undoEdit()
    useUIStore.getState().openSettings()
    expect(prompts()).toHaveLength(0)
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(ws().editing).toBeNull()
  })

  it('New layout asks with changes; Discard puts the layout back and creates it', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    ws().splitCell('kb', 'right')
    const creating = ws().createLayout('Fresh')
    await settle()
    expect(prompts()).toHaveLength(1)
    await answer('discard')
    expect(await creating).not.toBeNull()
    expect(ws().saved?.name).toBe('Fresh')
    expect((await stored(id!)).cells).toHaveLength(2)
  })

  it('Esc’s question (askLeaveEdit): the same question while it is up', async () => {
    await seed(twoColumns())
    await ws().enterEdit()
    ws().splitCell('kb', 'right')
    const first = ws().askLeaveEdit()
    const second = ws().askLeaveEdit()
    expect(first).toBe(second)
    expect(prompts()).toHaveLength(1)
    await answer('discard')
    expect(await first).toBe(true)
    expect(ws().editing).toBeNull()
    expect(ws().working?.cells).toHaveLength(2)
  })
})

describe('a data replace', () => {
  it('ends the mode with a notice; Restore’s lists aren’t deleted afterwards', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    ws().splitCell('kb', 'right')
    await refreshAllStores()
    expect(ws().editing).toBeNull()
    expect(snackbar()?.description).toBe('Edit layout closed: its changes weren’t saved.')
    expect((await stored(id!)).cells).toHaveLength(2)
  })

  it('a pending Restore is dropped, its lists left to the new data', async () => {
    const [id] = await seed(twoColumns())
    await ws().enterEdit()
    const list = await addListInMode(id!, 'ka')
    ws().cancelEdit()
    await refreshAllStores()
    useUndoStore.getState().dismissSnackbar()
    await settle()
    expect(await storedListIds()).toContain(list)
  })
})
