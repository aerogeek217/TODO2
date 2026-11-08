import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WorkspaceCell } from '../../../components/workspace/WorkspaceCell'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { createTab, type LayoutBody, type LayoutCell, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { makeTodo, resetEntityStores } from '../../helpers'
import { emptyPredicate } from '../../../models'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { band, cell, col, row } from '../../helpers/layout-builders'
import { cellAt, findCell } from '../../../utils/workspace-layout-queries'

/**
 * The cell menu's Split ▸ Right / Below / New column (a band's: Right only),
 * its Show / Hide tab strip toggle, and a headless cell: its strip marked
 * hidden, its right-click the tab menu.
 */

const AT = new Date(2026, 0, 1)

function open(body: LayoutBody): void {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'Main', createdAt: AT, modifiedAt: AT, ...body }
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
}

function working(): LayoutBody {
  const w = useWorkspaceStore.getState().working
  if (!w) throw new Error('no working layout')
  return w
}

function cellNow(id: string): LayoutCell | undefined {
  const loc = findCell(working(), id)
  return loc ? cellAt(working(), loc) : undefined
}

function renderCell(c: LayoutCell, extra: { band?: 'top' | 'bottom'; rowId?: string; fitRow?: boolean } = {}) {
  return render(
    <DndContext>
      <WorkspaceCell cell={c} band={extra.band} rowId={extra.rowId ?? 'r'} collapsed={false} fitRow={extra.fitRow} />
    </DndContext>,
  )
}

function cellMenu(name = 'Cell options'): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }))
  return screen.getByRole('menu', { name })
}

beforeEach(() => {
  resetEntityStores()
})

afterEach(cleanup)

describe('the cell menu', () => {
  it('Split ▸ Right puts an empty cell beside it in its row; Below a row under it; New column a column', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    const split = () => {
      const menu = cellMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Split' }))
      return screen.getAllByRole('menu').at(-1)!
    }
    const sub = split()
    expect(within(sub).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))).toEqual(['Right', 'Below', 'New column'])
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'Right' }))
    expect(working().columns[0]?.rows[0]?.cells.map((x) => x.tabs.length)).toEqual([1, 0])
    fireEvent.click(within(split()).getByRole('menuitem', { name: 'Below' }))
    expect(working().columns[0]?.rows).toHaveLength(2)
    fireEvent.click(within(split()).getByRole('menuitem', { name: 'New column' }))
    expect(working().columns).toHaveLength(2)
  })

  it('a band’s Split offers Right only', () => {
    const t = cell('t', [createTab('notes', 'n')])
    open({ columns: [], top: band('T', [t]) })
    renderCell(t, { band: 'top', rowId: 'T' })
    const menu = cellMenu('Band options')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Split' }))
    const sub = screen.getAllByRole('menu').at(-1)!
    expect(within(sub).getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))).toEqual(['Right'])
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'Right' }))
    expect(working().top?.cells).toHaveLength(2)
  })

  it('Hide tab strip writes `false`; Show tab strip on a hidden one goes back to the widget’s way (no key)', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open({ columns: [col('c', [row('r', [k])])] })
    const { rerender } = renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Hide tab strip' }))
    expect(cellNow('k')?.stripShown).toBe(false)
    const hidden = cellNow('k')!
    rerender(<DndContext><WorkspaceCell cell={hidden} rowId="r" collapsed={false} /></DndContext>)
    expect(document.querySelector('[data-ws-cell="k"]')).toHaveAttribute('data-headless', 'true')
    expect(document.querySelector('[data-ws-cell-header="k"]')).toHaveAttribute('data-strip-hidden')
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Show tab strip' }))
    expect(cellNow('k')).not.toHaveProperty('stripShown')
  })

  it('a cell of several tabs offers no strip toggle (it is never headless)', () => {
    const k = cell('k', [createTab('notes', 'n'), createTab('calendar', 'cal')])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    expect(within(cellMenu()).queryByRole('menuitem', { name: /tab strip/ })).toBeNull()
  })
})

describe('a headless cell', () => {
  it('right-click anywhere on it opens its tab’s menu', () => {
    const k = cell('k', [createTab('notes', 'n')], { stripShown: false })
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.getByRole('menu', { name: 'Change widget' })).toBeInTheDocument()
  })

  it('a cell that shows its strip leaves the right-click to its body', () => {
    const k = cell('k', [createTab('notes', 'n')])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    expect(document.querySelector('[data-ws-cell="k"]')).not.toHaveAttribute('data-headless')
    fireEvent.contextMenu(document.querySelector('[data-ws-cell-body="k"]')!)
    expect(screen.queryByRole('menu', { name: 'Change widget' })).toBeNull()
  })
})

describe('a cell’s widget faces (D25 R)', () => {
  const listTab = { id: 'l', kind: 'lens' as const, config: { listDefinitionId: 7 } }
  const cellEl = (id: string) => document.querySelector<HTMLElement>(`[data-ws-cell="${id}"]`)!
  const popover = () => document.querySelector<HTMLElement>('[data-testid="widget-face-popover"]')

  /** Every element measures `width` × `height` (JSDOM lays nothing out). */
  function stubSize(width: number, height: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
  }

  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 7, name: 'Team', sortOrder: 0, owner: { layoutId: 1 },
        membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
      }],
    })
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'One', sortOrder: 1 }), makeTodo({ id: 2, title: 'Two', sortOrder: 2 })] })
  })

  afterEach(() => vi.restoreAllMocks())

  it('a one-tab List cell at its small face is headless; its click opens the full list over it, Esc closes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('small')
    expect(cellEl('k').dataset.headless).toBe('true')
    expect(document.querySelector('[data-list-face="small"]')).not.toBeNull()

    fireEvent.click(document.querySelector('[data-list-face]')!)
    expect(popover()).not.toBeNull()
    expect(popover()!.getAttribute('aria-label')).toBe('Team')
    // The full widget, whatever the room: its rows.
    expect(within(popover()!).getAllByRole('button').some((b) => b.closest('[data-todo-id]'))).toBe(true)
    expect(popover()!.querySelector('[data-list-face]')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(popover()).toBeNull()
  })

  it('the keyboard opener opens it too; a second click on the face closes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    fireEvent.click(screen.getByRole('button', { name: 'Open Team' }))
    expect(popover()).not.toBeNull()
    fireEvent.click(document.querySelector('[data-list-face]')!)
    expect(popover()).toBeNull()
  })

  it('`stripShown: true` keeps a small face’s strip; Show tab strip at the small face writes it', () => {
    stubSize(400, 80)
    const k = cell('k', [listTab])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    fireEvent.click(within(cellMenu()).getByRole('menuitem', { name: 'Show tab strip' }))
    expect(cellNow('k')?.stripShown).toBe(true)
    cleanup()
    const shown = cell('k', [listTab], { stripShown: true })
    open({ columns: [col('c', [row('r', [shown])])] })
    renderCell(shown)
    expect(cellEl('k').dataset.face).toBe('small')
    expect(cellEl('k').dataset.headless).toBeUndefined()
  })

  it('a bigger List cell shows its strip and opens nothing on a click', () => {
    stubSize(400, 400)
    const k = cell('k', [listTab])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('large')
    expect(cellEl('k').dataset.headless).toBeUndefined()
    fireEvent.click(cellEl('k').querySelector('[data-ws-cell-body]')!)
    expect(popover()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Team' })).toBeNull()
  })

  it('a fit row’s cell shows its widget’s small face, whatever its measured size', () => {
    stubSize(400, 400)
    const n = cell('n', [createTab('number', 'num')])
    open({ columns: [col('c', [row('r', [n])])] })
    renderCell(n, { fitRow: true })
    expect(cellEl('n').dataset.face).toBe('small')
    expect(document.querySelector('[data-glance]')!.getAttribute('data-face')).toBe('small')
  })

  it('a widget without faces (Notes) is large and never opens a popover', () => {
    stubSize(400, 60)
    const k = cell('k', [createTab('notes', 'n')])
    open({ columns: [col('c', [row('r', [k])])] })
    renderCell(k)
    expect(cellEl('k').dataset.face).toBe('large')
    expect(cellEl('k').dataset.headless).toBeUndefined()
  })
})
