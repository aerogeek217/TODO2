import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ListWidget } from '../../../components/workspace/list/ListWidget'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { emptyPredicate } from '../../../models'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { LensTab, ListZoom } from '../../../models/workspace-layout'
import type { Person } from '../../../models'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * A list tab at each zoom (D25 C + I1), as far as JSDOM shows it: what each
 * level draws for a task, Strips' click, Ctrl + wheel's step and the
 * palette's commands. Heights, the wheel's page zoom and focus are the real
 * browser's (`e2e/list-zoom.spec.ts`).
 */

const ann: Person = { id: 1, name: 'Ann', initials: 'AN', color: '#c33' }
const DAY = 24 * 60 * 60 * 1000

const def: PersistedListDefinition = {
  id: 7, name: 'Team', sortOrder: 0,
  membership: { kind: 'custom', predicate: emptyPredicate() },
  sort: 'manual', grouping: 'none',
}

function tabAt(zoom?: ListZoom): LensTab {
  return { id: 't1', kind: 'lens', config: { listDefinitionId: 7 }, ...(zoom ? { viewState: { zoom } } : {}) }
}

function show(zoom?: ListZoom) {
  return render(<DndContext><ListWidget tab={tabAt(zoom)} /></DndContext>)
}

const widget = () => document.querySelector<HTMLElement>('[data-list-widget="t1"]')!
const grid = () => document.querySelector<HTMLElement>('[data-task-row-grid]')!
const paletteCommands = () => createCommands({ shortcuts: {} } as unknown as CommandContext)

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useListDraftStore.setState({ drafts: {} })
  useListWidgetStore.setState({ picks: {}, collapsed: {} })
  useUIStore.getState().clearSelection()
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
  useSettingsStore.setState({ urgentDueWithinDays: 3, staleAfterDays: 30, listZoom: 'rows' })
  usePersonStore.setState({ people: [ann], assignedPeopleMap: new Map([[1, [ann]]]) })
  useListDefinitionStore.setState({ listDefinitions: [def] })
  const now = Date.now()
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Late one', sortOrder: 1, dueDate: new Date(now - 2 * DAY) }),
      makeTodo({ id: 2, title: 'Plain one', sortOrder: 2 }),
    ],
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a list tab’s zoom', () => {
  it('a tab without its own zoom shows the Settings default', () => {
    useSettingsStore.setState({ listZoom: 'lines' })
    show()
    expect(grid()).toHaveAttribute('data-zoom', 'lines')
    expect(widget()).toHaveAttribute('data-zoom', 'lines')
  })

  it('Stacked: the title, then the details line (due · follow-up · people · tags); no notes or status, no divider', () => {
    show('stacked')
    const row = document.querySelector('[data-row-key] [data-todo-id="1"]')!
    const details = row.querySelector('[data-stacked-details]')!
    expect(row.querySelector('[data-task-title]')).toHaveTextContent('Late one')
    expect(Array.from(details.querySelectorAll('[data-row-cell]')).map((c) => c.getAttribute('data-row-cell')))
      .toEqual(['due', 'followup', 'people', 'tags'])
    expect(details.querySelector('[data-row-cell="due"]')).toHaveAttribute('data-due-past')
    expect(row.querySelector('[data-row-cell="notes"]')).toBeNull()
    expect(row.querySelector('[data-row-cell="status"]')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('Rows: the cells in columns', () => {
    show('rows')
    const row = document.querySelector('[data-row-key] [data-todo-id="1"]')!
    expect(row.querySelector('[data-stacked-details]')).toBeNull()
    expect(row.querySelector('[data-row-cell="status"]')).not.toBeNull()
  })

  it('Lines: a tick in the task’s tone and the title, no cells; a click selects and opens the editor, Ctrl-click only selects', () => {
    const open = vi.fn()
    useUIStore.setState({ openEditPopup: open })
    show('lines')
    const late = document.querySelector('[data-row-key] [data-todo-id="1"]')!
    expect(late).toHaveAttribute('data-tone', 'late')
    expect(document.querySelector('[data-todo-id="2"]')).toHaveAttribute('data-tone', 'none')
    expect(late.querySelector('[data-row-cell]')).toBeNull()
    fireEvent.click(late)
    expect(open).toHaveBeenCalledWith(1)
    expect(useUIStore.getState().selectedTodoIds).toEqual(new Set([1]))
    open.mockClear()
    fireEvent.click(document.querySelector('[data-todo-id="2"]')!, { ctrlKey: true })
    expect(open).not.toHaveBeenCalled()
    expect(useUIStore.getState().selectedTodoIds).toEqual(new Set([1, 2]))
  })

  it('Strips: a bar per task in its tone; a click zooms the tab to Rows on that task, selected', async () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    useWorkspaceStore.setState({ patchTabViewState: patch })
    show('strips')
    const bar = document.querySelector('[data-task-strip][data-todo-id="1"]')!
    expect(bar).toHaveAttribute('data-tone', 'late')
    expect(bar).toHaveAttribute('aria-label', 'Late one')
    await act(async () => { fireEvent.click(bar) })
    expect(patch).toHaveBeenCalledWith('t1', 'lens', { zoom: 'rows' })
    expect(useUIStore.getState().selectedTodoIds).toEqual(new Set([1]))
    expect(useUIStore.getState().selectionScope).toBe('t1')
  })

  it('Ctrl + wheel over the body steps the zoom, its default prevented; a plain wheel is left alone', () => {
    const patch = vi.fn().mockResolvedValue(undefined)
    useWorkspaceStore.setState({ patchTabViewState: patch })
    show('rows')
    const scroller = grid().parentElement!
    const plain = new WheelEvent('wheel', { deltaY: 100, cancelable: true })
    scroller.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
    expect(patch).not.toHaveBeenCalled()
    const zoomOut = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, cancelable: true })
    scroller.dispatchEvent(zoomOut)
    expect(zoomOut.defaultPrevented).toBe(true)
    expect(patch).toHaveBeenCalledWith('t1', 'lens', { zoom: 'lines' })
  })

  it('the palette offers Zoom List In / Out for the list on screen, each with its step', () => {
    const tab = tabAt('rows')
    useWorkspaceStore.setState({
      working: { id: 1, name: 'Main', sortOrder: 0, createdAt: new Date(), modifiedAt: new Date(), columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [tab] }] }] },
    })
    render(<DndContext><ListWidget tab={tab} /></DndContext>)
    expect(paletteCommands().filter((c) => c.id.startsWith('list-zoom-')).map((c) => [c.name, c.hint])).toEqual([
      ['Zoom List In', 'Rows → Stacked'],
      ['Zoom List Out', 'Rows → Lines'],
    ])
  })

  it('no zoom commands without a list on screen', () => {
    expect(paletteCommands().some((c) => c.id.startsWith('list-zoom-'))).toBe(false)
  })
})
