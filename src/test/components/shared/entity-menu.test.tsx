import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { DialogLayer } from '../../../components/shared/Dialog'
import { DialogLayerContext } from '../../../components/shared/dialog-layer'
import { EntityMenu, type MenuEntity } from '../../../components/shared/EntityMenu'
import type { Tag } from '../../../models'
import { createTab } from '../../../models/workspace-layout'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makePerson, makeTodo } from '../../helpers'
import { cell, grid } from '../../helpers/layout-builders'

/**
 * The one person / tag menu (D26): a person's Review with X · ─ · Show
 * tasks · Edit… · ─ · Delete…; a tag's Review #tag tasks · ─ · Show tasks ·
 * Edit… · ─ · Delete…. No check-ins (widget feedback 2B). Review follows
 * Show tasks' layer rule; Review —
 * a jump to a Review widget — is also left out on a phone and while no
 * layout has a Review widget.
 */

const AT = new Date(2026, 0, 1)
const reviewFilter = () => useListWidgetStore.getState().reviewFilters.rv

const aisha = makePerson({ id: 1, name: 'Aisha Rahman', initials: 'AR' })
const ben = makePerson({ id: 2, name: 'Ben Ortiz', initials: 'BO' })
const legal: Tag = { id: 7, name: 'legal', color: '#999' }

const PERSON_MENU = ['Review with Aisha Rahman', 'Show tasks', 'Edit…', 'Delete…']

beforeEach(() => {
  useTodoStore.setState({
    todos: [makeTodo({ id: 1, sortOrder: 2 }), makeTodo({ id: 2, sortOrder: 1 }), makeTodo({ id: 3, sortOrder: 3, isCompleted: true })],
  })
  usePersonStore.setState({ people: [aisha, ben], assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha, ben]], [3, [ben]]]) })
  useTagStore.setState({ tags: [legal], assignedTagsMap: new Map([[1, [legal]], [2, []], [3, []]]) })
  useUIStore.setState({ checkinDialog: null, checkinImportOpen: false, taskDialog: null })
  const layout = { id: 1, name: 'Main', sortOrder: 0, createdAt: AT, modifiedAt: AT, ...grid([[cell('a', [createTab('review', 'rv')])]]) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
})

afterEach(cleanup)

function renderMenu(entities: MenuEntity[], { layer = null, onShowTasks }: { layer?: DialogLayer | null; onShowTasks?: () => void } = {}) {
  const onClose = vi.fn()
  const menu: ReactNode = <EntityMenu entities={entities} point={{ x: 20, y: 20 }} onShowTasks={onShowTasks} onClose={onClose} />
  render(<DialogLayerContext.Provider value={layer}>{menu}</DialogLayerContext.Provider>)
  return { onClose }
}

const items = (menu = screen.getByRole('menu')) => within(menu).getAllByRole('menuitem').map((i) => i.textContent)
const person: MenuEntity = { kind: 'person', entity: aisha }
const tag: MenuEntity = { kind: 'tag', entity: legal }

describe('EntityMenu — a person', () => {
  it('Review, then Show tasks · Edit…, then Delete…', () => {
    renderMenu([person])
    const menu = screen.getByRole('menu', { name: '@Aisha Rahman' })
    expect(items(menu)).toEqual(PERSON_MENU)
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2)
  })

  it('Review with X jumps to the Review widget with @X as its filter', async () => {
    const onShowTasks = vi.fn()
    const { onClose } = renderMenu([person], { onShowTasks })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review with Aisha Rahman' }))
    await waitFor(() => expect(reviewFilter()).toEqual({ expression: { kind: 'person', id: 1 }, showCompleted: false }))
    expect(onShowTasks).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalled()
  })

  it('no check-in items (they live on the Review widget’s field)', () => {
    renderMenu([person])
    expect(screen.queryByRole('menuitem', { name: /Email check-in|Paste reply/ })).toBeNull()
  })
})

describe('EntityMenu — a tag', () => {
  it('Review #tag tasks, then Show tasks · Edit…, then Delete…', () => {
    renderMenu([tag])
    expect(items(screen.getByRole('menu', { name: '#legal' }))).toEqual(['Review #legal tasks', 'Show tasks', 'Edit…', 'Delete…'])
  })

  it('Review #tag tasks jumps with #tag as the filter', async () => {
    renderMenu([tag])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review #legal tasks' }))
    await waitFor(() => expect(reviewFilter()).toEqual({ expression: { kind: 'tag', id: 7 }, showCompleted: false }))
  })
})

describe('EntityMenu — where Review is offered', () => {
  it.each(['dialog', 'raised', 'nested'] as const)('inside a %s-tier dialog: Edit… and Delete… only', (layer) => {
    renderMenu([person], { layer })
    expect(items()).toEqual(['Edit…', 'Delete…'])
    cleanup()
    renderMenu([tag], { layer })
    expect(items()).toEqual(['Edit…', 'Delete…'])
  })

  it('on the overlay tier (the task dialog): the whole menu', () => {
    renderMenu([person], { layer: 'overlay' })
    expect(items()).toEqual(PERSON_MENU)
  })

  it('no Review widget on the layout: Review still offered (the popup review)', () => {
    const plain = { id: 1, name: 'Main', sortOrder: 0, createdAt: AT, modifiedAt: AT, ...grid([[cell('a', [createTab('notes', 'n')])]]) }
    useWorkspaceStore.setState({ working: plain, saved: plain, layouts: [plain], activeLayoutId: 1 })
    renderMenu([person], { layer: 'overlay' })
    expect(items()).toEqual(PERSON_MENU)
    cleanup()
    renderMenu([tag], { layer: 'overlay' })
    expect(items()).toEqual(['Review #legal tasks', 'Show tasks', 'Edit…', 'Delete…'])
  })

  it('on a phone: Review offered too', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('max-width: 640px') })) as typeof window.matchMedia
    try {
      renderMenu([person])
      expect(items()).toEqual(PERSON_MENU)
    } finally {
      window.matchMedia = original
    }
  })
})

describe('EntityMenu — a row’s cell (one submenu per entity)', () => {
  it('each person’s submenu holds the same entries', async () => {
    renderMenu([person, { kind: 'person', entity: ben }])
    const menu = screen.getByRole('menu', { name: 'People' })
    expect(items(menu)).toEqual(['@Aisha Rahman', '@Ben Ortiz'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: '@Ben Ortiz' }))
    const sub = screen.getAllByRole('menu').find((m) => m !== menu)
    expect(sub && items(sub)).toEqual([
      'Review with Ben Ortiz', 'Show tasks', 'Edit…', 'Delete…',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Review with Ben Ortiz' }))
    await waitFor(() => expect(reviewFilter()?.expression).toEqual({ kind: 'person', id: 2 }))
  })
})
