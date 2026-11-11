import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { db } from '../../../data/database'
import { layoutRepository } from '../../../data/layout-repository'
import { writeLayoutDraft } from '../../../data/draft-storage'
import { createTab, type WorkspaceLayout } from '../../../models/workspace-layout'
import { emptyPredicate } from '../../../models/filter-predicate'
import { LayoutControls } from '../../../components/workspace/LayoutControls'
import { settleLayoutWrites, useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useUIStore } from '../../../stores/ui-store'
import { resetDb } from '../../helpers'
import { emptyBody, single } from '../../helpers/layout-builders'

/**
 * The top bar's layout controls: the layouts as tabs (click opens one, the
 * tab menu — Move left / right, Edit…, Delete… naming the lists that
 * go — and `+` asking a name), or folded into the picker.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

const layout = (name: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({
  name, createdAt: T0, modifiedAt: T0,
  ...single({ id: 'ka', tabs: [createTab('notes', `${name}-n`)] }),
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

  it('every edit is saved: no unsaved dot, no save button — Couldn’t save · Retry shows only while a write has failed', async () => {
    await seed('Main')
    render(<LayoutControls mode="tabs" />)
    act(() => ws().closeTab('Main-n'))
    await act(async () => { await settleLayoutWrites() })
    expect(within(tab('Main')).queryByRole('img')).toBeNull()
    expect(screen.queryByTestId('layout-save')).toBeNull()
    expect(screen.queryByTestId('layout-write-failed')).toBeNull()
    act(() => useWorkspaceStore.setState({ writeFailed: true }))
    expect(screen.getByTestId('layout-write-failed')).toHaveAccessibleName('Couldn\'t save layout Main. Retry')
  })

  it('another tab’s menu: Edit…, Move left / right, Delete layout… (no Save / Discard); Move right moves it', async () => {
    const [, b] = await seed('Main', 'Second', 'Third')
    render(<LayoutControls mode="tabs" />)
    fireEvent.contextMenu(tab('Second'))
    const menu = screen.getByRole('menu', { name: 'Layout Second' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit…', 'Move left', 'Move right', 'Delete layout…'])
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
    // The open layout's own action leads: Duplicate layout… (no Save / Discard).
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Duplicate layout…', 'Edit…', 'Move left', 'Move right', 'Delete layout…'])
  })

  it('Duplicate layout… asks a name (the layout’s, “copy”) and opens the copy', async () => {
    await seed('Main')
    render(<LayoutControls mode="tabs" />)
    fireEvent.contextMenu(tab('Main'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate layout…' }))
    const dialog = screen.getByRole('dialog', { name: 'Duplicate layout' })
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Main copy')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => expect(tabNames()).toEqual(['Main', 'Main copy']))
    expect(tab('Main copy')).toHaveAttribute('aria-selected', 'true')
    expect(await db.layouts.count()).toBe(2)
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
    expect(ws()).toMatchObject({ writeFailed: false })
    expect(await db.layouts.count()).toBe(2)
  })

  it('a kept new layout from an older build is a stored layout’s tab, open', async () => {
    await seed('Main')
    writeLayoutDraft({ kind: 'new', name: 'Untitled layout', body: { ...emptyBody() } })
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
    await ws().init()
    render(<LayoutControls mode="tabs" />)
    expect(tabNames()).toEqual(['Main', 'Untitled layout'])
    expect(tab('Untitled layout')).toHaveAttribute('aria-selected', 'true')
    expect(await db.layouts.count()).toBe(2)
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
      'New layout…', 'Duplicate layout…', 'Edit…', 'Delete layout…',
    ])
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'New layout…' }))
    expect(screen.getByRole('dialog', { name: 'New layout' })).toBeInTheDocument()
  })
})

describe('LayoutControls — requests from elsewhere (the palette)', () => {
  const ui = () => useUIStore.getState()

  it('a switch request opens the layout as a tab click does, and is taken once', async () => {
    const [, second] = await seed('Main', 'Second')
    render(<LayoutControls mode="tabs" />)
    act(() => ui().requestLayout({ kind: 'switch', layoutId: second! }))
    await waitFor(() => expect(ws().working?.name).toBe('Second'))
    expect(ui().layoutRequest).toBeNull()
  })

  it('a switch to the open layout does nothing', async () => {
    const [main] = await seed('Main', 'Second')
    render(<LayoutControls mode="menu" />)
    act(() => ui().requestLayout({ kind: 'switch', layoutId: main! }))
    expect(ui().layoutRequest).toBeNull()
    expect(ws().working?.name).toBe('Main')
  })

  it('New layout… and Duplicate layout… open their name dialogs', async () => {
    await seed('Main')
    render(<LayoutControls mode="tabs" />)
    act(() => ui().requestLayout({ kind: 'new' }))
    const created = screen.getByRole('dialog', { name: 'New layout' })
    fireEvent.click(within(created).getByRole('button', { name: 'Cancel' }))
    act(() => ui().requestLayout({ kind: 'duplicate' }))
    expect(within(screen.getByRole('dialog', { name: 'Duplicate layout' })).getByLabelText('Name')).toHaveValue('Main copy')
  })
})
