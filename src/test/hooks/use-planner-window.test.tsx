import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { layoutRepository } from '../../data/layout-repository'
import { usePlanner, usePlannerWindowsOf } from '../../hooks/use-planner'
import { createTab, type LayoutBody } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { plannerWindowKey, usePlannerStore } from '../../stores/planner-store'
import { useUndoStore } from '../../stores/undo-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { layoutTabs } from '../../utils/workspace-layout-queries'
import { resetDb } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'

/**
 * A Planner's window (its week, `stores/planner-store`) is
 * its tab's **in its layout**: a duplicated layout keeps its tabs' ids, and
 * its Planner starts on this week all the same; and a tab that stops being
 * a Planner — Change widget, an undo — loses its window, so it starts on
 * this week when it is a Planner again. On the real workspace store.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

/** What the workspace page does, and a Planner tab `p` of the open layout reading its window. */
function Harness() {
  const working = useWorkspaceStore((s) => s.working)
  usePlannerWindowsOf(working)
  const tab = working ? layoutTabs(working).find((t) => t.id === 'p') : undefined
  return <div>{tab?.kind === 'planner' ? <Planner /> : <output data-testid="kind">{tab?.kind ?? 'no tab'}</output>}</div>
}

function Planner() {
  const { offset, windowKey } = usePlanner('p', undefined, false)
  return <output data-testid="window" data-key={windowKey}>{String(offset)}</output>
}

const shown = () => screen.getByTestId('window').textContent
const keyShown = () => screen.getByTestId('window').getAttribute('data-key') ?? ''
const tabIds = (layout: LayoutBody | null) => (layout ? layoutTabs(layout).map((t) => `${t.id}:${t.kind}`) : [])

let layoutId = 0

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  useListOrderStore.setState({ ranks: new Map(), loaded: false })
  useUndoStore.getState().clear()
  layoutId = await layoutRepository.insert({
    name: 'Week', createdAt: T0, modifiedAt: T0,
    ...grid([[cell('k1', [createTab('planner', 'p')], { activeTabId: 'p' }), cell('k2', [createTab('notes', 'n')], { activeTabId: 'n' })]]),
  })
  await layoutRepository.setActiveId(layoutId)
  await Promise.all([useListDefinitionStore.getState().load(), useListOrderStore.getState().load()])
  await ws().init()
})

afterEach(cleanup)

/** Moves the shown Planner a week on. */
function moveOn() {
  act(() => {
    usePlannerStore.getState().shift(keyShown(), 1)
  })
}

describe('a Planner’s window is its tab’s in its layout', () => {
  it('is keyed by the open layout and the tab', () => {
    render(<Harness />)
    expect(keyShown()).toBe(plannerWindowKey(layoutId, 'p'))
    expect(shown()).toBe('0')
    moveOn()
    expect(shown()).toBe('7')
  })

  it('a duplicated layout keeps its tabs’ ids, and its Planner starts on this week; the original keeps its week', async () => {
    render(<Harness />)
    moveOn()
    let copyId: number | null = null
    await act(async () => { copyId = await ws().duplicateLayout('Week copy') })
    expect(copyId).not.toBeNull()
    expect(ws().working?.id).toBe(copyId)
    // The copy's Planner tab has the original's id.
    expect(tabIds(ws().working)).toEqual(['p:planner', 'n:notes'])
    expect(keyShown()).toBe(plannerWindowKey(copyId, 'p'))
    expect(shown()).toBe('0')
    // A move in the copy is the copy's.
    act(() => usePlannerStore.getState().shift(keyShown(), 2))
    expect(shown()).toBe('14')
    await act(async () => { await ws().load(layoutId) })
    expect(keyShown()).toBe(plannerWindowKey(layoutId, 'p'))
    expect(shown()).toBe('7')
  })
})

describe('a tab that stops being a Planner loses its window', () => {
  it('Change widget away and back: this week again', () => {
    render(<Harness />)
    moveOn()
    act(() => ws().changeTabKind('p', 'notes'))
    expect(screen.getByTestId('kind')).toHaveTextContent('notes')
    expect(usePlannerStore.getState().windows).toEqual({})
    act(() => ws().changeTabKind('p', 'planner'))
    expect(shown()).toBe('0')
  })

  it('an undo that makes it another kind, and the redo that makes it a Planner again', async () => {
    // The tab starts as Notes, becomes a Planner, and is moved on.
    await act(async () => { ws().changeTabKind('n', 'planner') })
    const key = plannerWindowKey(layoutId, 'n')
    act(() => usePlannerStore.getState().shift(key, 3))
    render(<Harness />)
    expect(usePlannerStore.getState().windows[key]).toEqual({ offset: 21 })
    await act(async () => { await useUndoStore.getState().undo() })
    expect(tabIds(ws().working)).toEqual(['p:planner', 'n:notes'])
    expect(usePlannerStore.getState().windows[key]).toBeUndefined()
    await act(async () => { await useUndoStore.getState().redo() })
    expect(tabIds(ws().working)).toEqual(['p:planner', 'n:planner'])
    expect(usePlannerStore.getState().windows[key]).toBeUndefined()
  })

  it('a tab closed takes its window; the layout’s other Planner and another layout’s keep theirs', () => {
    render(<Harness />)
    moveOn()
    const other = plannerWindowKey(layoutId + 100, 'p')
    act(() => usePlannerStore.getState().shift(other, 1))
    act(() => ws().changeTabKind('n', 'planner'))
    const second = plannerWindowKey(layoutId, 'n')
    act(() => usePlannerStore.getState().shift(second, 2))
    act(() => { void ws().removeWidget('n') })
    const { windows } = usePlannerStore.getState()
    expect(windows[second]).toBeUndefined()
    expect(windows[plannerWindowKey(layoutId, 'p')]?.offset).toBe(7)
    expect(windows[other]?.offset).toBe(7)
  })

  it('a view change (a tab’s hand order) leaves the window alone', () => {
    render(<Harness />)
    moveOn()
    act(() => { void ws().patchTabViewState('p', 'planner', { order: ['a', 'b'] }) })
    expect(shown()).toBe('7')
  })
})
