import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, renderHook, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import type { MenuItemEntry } from '../../../components/shared/MenuPopover'
import { PlannerWidget } from '../../../components/workspace/planner/PlannerWidget'
import { PlannerSettingsHost } from '../../../components/workspace/planner/PlannerSettings'
import { usePlannerMenuEntries } from '../../../components/workspace/planner/planner-reset'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { PersistedWorkspaceLayout, PlannerTab } from '../../../models/workspace-layout'
import { usePlannerStore } from '../../../stores/planner-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * The Planner's Unplanned filter in JSDOM (board E): the filter read back in
 * words under the Unplanned heading; a click on it — or What counts as
 * unplanned… in the widget's ⋯ — opens the Planner settings, whose
 * Unplanned holds field is the Number editor's filter field; the Planner
 * draws the filter as edited; Save writes it as one undo step; with changes,
 * leaving asks Save / Discard / Keep editing.
 */

const TODAY = new Date(2026, 10, 20, 10)
const ERRANDS = { id: 4, name: 'errands', color: '#888' }

function setup(tab: PlannerTab = { id: 'plan', kind: 'planner', config: {} }) {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [tab] }) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], writeFailed: false })
  return render(
    <DndContext>
      <Live />
      <PlannerSettingsHost />
      <ConfirmPromptHost />
    </DndContext>,
  )
}

function Live() {
  const tab = useWorkspaceStore((s) => s.working!.cells[0]!.tabs[0]) as PlannerTab
  return <WidgetFaceContext.Provider value={{ forced: 'large' }}><PlannerWidget tab={tab} /></WidgetFaceContext.Provider>
}

const stored = () => useWorkspaceStore.getState().working!.cells[0]!.tabs[0] as PlannerTab
const unplanned = () => [...document.querySelectorAll('[data-planner-group="unplanned"] [data-task-title]')].map((r) => r.getAttribute('data-task-title'))
const line = () => document.querySelector<HTMLElement>('[data-planner-filter-line="plan"]')!
const settings = () => document.querySelector<HTMLElement>('[data-planner-settings="plan"]')
const openFromLine = () => fireEvent.click(within(line()).getByRole('button'))
/** Types `text` as the filter's expression, then leaves the field, which writes it at once. */
const typeFilter = (text: string) => {
  const field = within(settings()!).getByTestId('planner-settings-filter')
  if (within(field).queryByRole('textbox', { name: 'Filter expression' }) == null) fireEvent.click(within(field).getByRole('radio', { name: 'Expression' }))
  const box = within(field).getByRole('textbox', { name: 'Filter expression' })
  fireEvent.change(box, { target: { value: text } })
  fireEvent.blur(box)
}
const question = (title: string) => screen.getByRole('dialog', { name: title })
async function answer(title: string, label: 'Save' | 'Discard' | 'Keep editing') {
  await act(async () => { fireEvent.click(within(question(title)).getByRole('button', { name: label })) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  resetEntityStores()
  clearFilterStore()
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, uid: 'focus', title: 'Someday focus', focus: true, sortOrder: 1 }),
      makeTodo({ id: 2, uid: 'errand', title: 'Pick up dry cleaning', sortOrder: 2 }),
      makeTodo({ id: 3, uid: 'held', title: 'Clean up shared drive', unplanned: true, sortOrder: 3 }),
      makeTodo({ id: 4, uid: 'dated', title: 'Dated errand', dueDate: new Date(2026, 10, 22), sortOrder: 4 }),
    ],
  })
  useTagStore.setState({ tags: [ERRANDS], assignedTagsMap: new Map([[2, [ERRANDS]], [4, [ERRANDS]]]) })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Unplanned filter line', () => {
  it('reads Focus for a Planner that never set one; Unplanned holds the Focus task and the held one', () => {
    setup()
    expect(within(line()).getByRole('button', { name: 'What counts as unplanned: Focus' })).toBeInTheDocument()
    expect(unplanned()).toEqual(['Clean up shared drive', 'Someday focus'])
  })

  it('reads a stored filter in words; Unplanned follows it, the dated task on its day all the same', () => {
    setup({ id: 'plan', kind: 'planner', config: { unplanned: { ...emptyPredicate(), tags: [4] } } })
    expect(line()).toHaveTextContent('errands')
    expect(unplanned()).toEqual(['Clean up shared drive', 'Pick up dry cleaning'])
    expect(document.querySelector('[data-planner-group="2026-11-22"]')).toHaveTextContent('Dated errand')
  })

  it('an empty filter: nothing joins on its own, only what was unplanned by hand', () => {
    setup({ id: 'plan', kind: 'planner', config: { unplanned: emptyPredicate() } })
    expect(within(line()).getByRole('button', { name: 'What counts as unplanned: nothing joins on its own' })).toHaveTextContent('Nothing joins on its own')
    expect(unplanned()).toEqual(['Clean up shared drive'])
  })
})

describe('the Planner settings', () => {
  it('open from the filter line: Unplanned holds, as the Number editor’s filter field, and what it means', () => {
    setup()
    openFromLine()
    expect(usePlannerStore.getState().settingsTabId).toBe('plan')
    const dialog = screen.getByRole('dialog', { name: 'Planner settings' })
    expect(dialog).toBe(settings())
    expect(within(dialog).getByRole('group', { name: 'Unplanned holds' })).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: 'Graphical' })).toHaveAttribute('aria-checked', 'true')
    expect(within(dialog).getByTestId('list-filter-chip')).toHaveTextContent('Focus')
    expect(dialog).toHaveTextContent('An open task with no day that matches joins Unplanned on its own. Empty, nothing joins on its own: only what you unplan.')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(settings()).toBeNull()
    expect(layoutSteps()).toEqual([])
  })

  it('open from What counts as unplanned… in the widget’s ⋯ menu', () => {
    setup()
    const { result } = renderHook(() => usePlannerMenuEntries(stored()))
    const entry = result.current.find((e): e is MenuItemEntry => e.kind === 'item' && e.label === 'What counts as unplanned…')
    act(() => { entry!.onSelect!() })
    expect(settings()).not.toBeNull()
  })

  it('the Planner draws the filter as edited; Save writes it as one undo step', async () => {
    setup()
    openFromLine()
    typeFilter('#errands')
    expect(unplanned()).toEqual(['Clean up shared drive', 'Pick up dry cleaning'])
    expect(stored().config).toEqual({})
    fireEvent.click(within(settings()!).getByRole('button', { name: 'Save' }))
    expect(settings()).toBeNull()
    expect(stored().config.unplanned?.expression).toEqual({ kind: 'tag', id: 4 })
    expect(layoutSteps()).toEqual(['Changed what counts as unplanned'])
    expect(useWidgetPreviewStore.getState().configs).toEqual({})
    expect(unplanned()).toEqual(['Clean up shared drive', 'Pick up dry cleaning'])
    await act(async () => { await useUndoStore.getState().undo() })
    expect(stored().config).toEqual({})
    expect(unplanned()).toEqual(['Clean up shared drive', 'Someday focus'])
  })

  it('emptied, nothing joins on its own', () => {
    setup()
    openFromLine()
    fireEvent.click(within(settings()!).getByRole('button', { name: 'Remove filter' }))
    expect(settings()).toHaveTextContent('No filter — nothing joins on its own')
    expect(unplanned()).toEqual(['Clean up shared drive'])
    fireEvent.click(within(settings()!).getByRole('button', { name: 'Save' }))
    expect(stored().config.unplanned).toEqual(emptyPredicate())
  })

  it('with changes, Esc asks Save / Discard / Keep editing (the editor-leave rule)', async () => {
    setup()
    openFromLine()
    typeFilter('#errands')
    // Esc in the field puts its text back (the field's own); Esc on the dialog asks.
    fireEvent.keyDown(within(settings()!).getByRole('button', { name: 'Save' }), { key: 'Escape' })
    const title = 'Save changes to the Planner?'
    await answer(title, 'Keep editing')
    expect(settings()).not.toBeNull()
    expect(stored().config).toEqual({})
    fireEvent.click(within(settings()!).getByRole('button', { name: 'Close' }))
    await answer(title, 'Discard')
    expect(settings()).toBeNull()
    expect(stored().config).toEqual({})
    expect(unplanned()).toEqual(['Clean up shared drive', 'Someday focus'])
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(layoutSteps()).toEqual([])
  })
})
