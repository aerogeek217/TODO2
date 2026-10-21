import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { db } from '../../../data/database'
import { layoutRepository } from '../../../data/layout-repository'
import { writeLayoutDraft } from '../../../data/draft-storage'
import { createTab, type WorkspaceLayout } from '../../../models/workspace-layout'
import { emptyPredicate } from '../../../models/filter-predicate'
import { LayoutControls } from '../../../components/workspace/LayoutControls'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { resetDb } from '../../helpers'

/**
 * The top bar's layout controls: the layouts as tabs (click opens one, the
 * tab menu — Move left / right, Rename…, Delete… naming the lists that
 * go — and `+` asking a name), or folded into the picker.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

const layout = (name: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({
  name, createdAt: T0, modifiedAt: T0,
  columns: [{ id: 'A', weight: 1, cells: [{ id: 'ka', weight: 1, tabs: [createTab('notes', `${name}-n`)] }] }],
})

async function seed(...names: string[]): Promise<number[]> {
  const ids: number[] = []
  for (const n of names) ids.push(await layoutRepository.insert(layout(n)))
  await layoutRepository.setActiveId(ids[0]!)
  await ws().init()
  return ids
}

const tabNames = () => screen.getAllByTestId('layout-tab').map((t) => t.textContent)
const tab = (name: string) => screen.getAllByTestId('layout-tab').find((t) => t.textContent === name)!

afterEach(cleanup)

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
})

describe('LayoutControls — tabs', () => {
  it('one tab per layout in their order, the open one selected; a click on another opens it', async () => {
    await seed('Main', 'Second')
    render(<LayoutControls mode="tabs" />)
    expect(screen.getByRole('tablist', { name: 'Layouts' })).toBeInTheDocument()
    expect(tabNames()).toEqual(['Main', 'Second'])
    expect(tab('Main')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('layout-picker')).toBeNull()
    fireEvent.click(tab('Second'))
    await waitFor(() => expect(ws().working?.name).toBe('Second'))
    expect(tab('Second')).toHaveAttribute('aria-selected', 'true')
  })

  it('the keys a tab handles (Enter, Space, arrows, Home, End) don’t reach the app shortcuts', async () => {
    await seed('Main', 'Second')
    render(<LayoutControls mode="tabs" />)
    const reached: string[] = []
    const listener = (e: KeyboardEvent) => reached.push(e.key)
    window.addEventListener('keydown', listener)
    try {
      for (const key of ['Enter', ' ', 'ArrowRight', 'ArrowLeft', 'Home', 'End']) fireEvent.keyDown(tab('Main'), { key })
      // Others still do (e.g. a shortcut's letter).
      fireEvent.keyDown(tab('Main'), { key: 'g' })
    } finally {
      window.removeEventListener('keydown', listener)
    }
    expect(reached).toEqual(['g'])
  })

  it('the open tab shows the unsaved dot while the layout is unsaved', async () => {
    await seed('Main')
    render(<LayoutControls mode="tabs" />)
    expect(within(tab('Main')).queryByRole('img', { name: 'unsaved changes' })).toBeNull()
    act(() => ws().closeTab('Main-n'))
    expect(within(tab('Main')).getByRole('img', { name: 'unsaved changes' })).toBeInTheDocument()
  })

  it('another tab’s menu: Rename…, Move left / right, Delete layout… (no Save / Discard); Move right moves it', async () => {
    const [, b] = await seed('Main', 'Second', 'Third')
    render(<LayoutControls mode="tabs" />)
    fireEvent.contextMenu(tab('Second'))
    const menu = screen.getByRole('menu', { name: 'Layout Second' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Rename…', 'Move left', 'Move right', 'Delete layout…'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }))
    await waitFor(() => expect(tabNames()).toEqual(['Main', 'Third', 'Second']))
    expect(ws().layouts.map((l) => l.id).at(-1)).toBe(b)
  })

  it('Shift+F10 on a tab opens its menu; the first tab can’t move left, the last can’t move right', async () => {
    await seed('Main', 'Second')
    render(<LayoutControls mode="tabs" />)
    fireEvent.keyDown(tab('Main'), { key: 'F10', shiftKey: true })
    const menu = screen.getByRole('menu', { name: 'Layout Main' })
    expect(within(menu).getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Move right' })).toBeEnabled()
    // The open layout's own actions lead.
    expect(within(menu).getByRole('menuitem', { name: 'Save as new layout…' })).toBeInTheDocument()
  })

  it('Delete layout… from a tab names the lists that go with it', async () => {
    const [, b] = await seed('Main', 'Second')
    await db.listDefinitions.bulkAdd([
      { name: 'Own', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: b! } },
      { name: 'Saved', sortOrder: 1, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() } },
    ])
    await useListDefinitionStore.getState().load()
    render(<LayoutControls mode="tabs" />)
    fireEvent.contextMenu(tab('Second'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete layout…' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete layout “Second”?' })
    expect(dialog).toHaveTextContent('The layout and its list are removed.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete layout' }))
    await waitFor(() => expect(tabNames()).toEqual(['Main']))
    expect(ws().working?.name).toBe('Main')
  })

  it('+ asks a name (empty can’t be confirmed); Create stores the empty layout and opens it', async () => {
    await seed('Main')
    render(<LayoutControls mode="tabs" />)
    fireEvent.click(screen.getByRole('button', { name: 'New layout' }))
    const dialog = screen.getByRole('dialog', { name: 'New layout' })
    const create = within(dialog).getByRole('button', { name: 'Create layout' })
    expect(create).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Planning' } })
    fireEvent.click(create)
    await waitFor(() => expect(tabNames()).toEqual(['Main', 'Planning']))
    expect(tab('Planning')).toHaveAttribute('aria-selected', 'true')
    expect(ws()).toMatchObject({ isDirty: false })
    expect(await db.layouts.count()).toBe(2)
  })

  it('a kept new layout from an older build: the open tab after the saved ones; Save asks its name', async () => {
    await seed('Main')
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: { columns: [] }, listNames: {} })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    render(<LayoutControls mode="tabs" />)
    expect(tabNames()).toEqual(['Main', 'Untitled layout'])
    expect(tab('Untitled layout')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByTestId('layout-save'))
    const dialog = screen.getByRole('dialog', { name: 'Save layout' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Untitled layout')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Planning' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save layout' }))
    await waitFor(() => expect(tabNames()).toEqual(['Main', 'Planning']))
    expect(ws().saved?.name).toBe('Planning')
  })
})

describe('LayoutControls — folded into the picker', () => {
  it('the picker lists the layouts in the same order, then New layout…, the open layout’s actions', async () => {
    const [a, b] = await seed('Main', 'Second')
    await ws().reorderLayouts([b!, a!])
    render(<LayoutControls mode="menu" />)
    expect(screen.queryByRole('tablist')).toBeNull()
    fireEvent.click(screen.getByTestId('layout-picker'))
    const menu = screen.getByRole('menu', { name: 'Layouts' })
    expect(within(menu).getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['Second', 'Main'])
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'New layout…', 'Save changes', 'Save as new layout…', 'Discard changes', 'Rename…', 'Delete layout…',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'New layout…' }))
    expect(screen.getByRole('dialog', { name: 'New layout' })).toBeInTheDocument()
  })
})
