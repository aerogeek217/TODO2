import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { db } from '../../../data/database'
import { SETTING_KEYS } from '../../../data/setting-keys'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useFilterStore } from '../../../stores/filter-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { makeTodo } from '../../helpers'

const LAYOUT: PersistedWorkspaceLayout = { id: 1, name: 'Default', sortOrder: 0, columns: [], createdAt: new Date(0), modifiedAt: new Date(0) }
const FOCUS_LENS = { id: 'lens-f', name: 'Focus only', predicate: { ...emptyPredicate(), markers: { focus: true } } }
const PEOPLE_LENS = { id: 'lens-p', name: 'Has a person', predicate: { ...emptyPredicate(), personIds: [0], negate: { personIds: true as const } } }

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

const tray = () => screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
const counter = () => within(tray()).queryByRole('button', { name: /tasks shown\. Show them$/ })

describe('the lens control and the counter', () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [
      makeTodo({ id: 1, title: 'Focus one', focus: true }),
      makeTodo({ id: 2, title: 'Focus two', focus: true, important: true }),
      makeTodo({ id: 3, title: 'Plain' }),
      makeTodo({ id: 4, title: 'Done', isCompleted: true, focus: true }),
    ] })
    useSettingsStore.setState({ lenses: [FOCUS_LENS, PEOPLE_LENS] })
    useWorkspaceStore.setState({ working: LAYOUT, saved: LAYOUT, hydrated: true })
  })

  afterEach(cleanup)

  it('No lens: muted glasses, no toggle, no counter', () => {
    renderBar()
    expect(within(tray()).getByRole('button', { name: 'Lens: none' })).toHaveTextContent('No lens')
    expect(within(tray()).queryByRole('button', { name: /^Lens (on|lifted)/ })).toBeNull()
    expect(counter()).toBeNull()
  })

  it('the picker lists No lens and each lens with its filters and what it hides; a pick is the top bar’s, saved at once and no layout edit', async () => {
    renderBar()
    fireEvent.click(within(tray()).getByRole('button', { name: 'Lens: none' }))
    const menu = screen.getByRole('menu', { name: 'Lens' })
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(items[0]).toHaveTextContent('No lens3 shown')
    expect(items[1]).toHaveTextContent('Focus only')
    expect(items[1]).toHaveTextContent('Priority Focus')
    expect(items[1]).toHaveTextContent('hides 1')
    expect(items[2]).toHaveTextContent('People not Unassigned')
    expect(items[2]).toHaveTextContent('hides 3')
    expect(menu).toHaveTextContent('Lens · hides tasks on every widget')
    expect(menu).not.toHaveTextContent(/layout/)
    fireEvent.click(items[1]!)
    expect(useSettingsStore.getState().activeLensId).toBe('lens-f')
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
    await vi.waitFor(async () => expect((await db.settings.get(SETTING_KEYS.activeLensId))?.value).toBe('lens-f'))
  })

  it('a lens on: accent glasses pressed, the counter neutral at what it keeps of every open task', () => {
    useSettingsStore.setState({ activeLensId: 'lens-f' })
    renderBar()
    const toggle = within(tray()).getByRole('button', { name: 'Lens on. Lift it' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(counter()).toHaveAccessibleName('2 of 3 open tasks shown. Show them')
    expect(tray().className).not.toMatch(/trayActive/)
  })

  it('the glasses lift it for now — every open task, the pick kept — and put it back', () => {
    useSettingsStore.setState({ activeLensId: 'lens-f' })
    renderBar()
    fireEvent.click(within(tray()).getByRole('button', { name: 'Lens on. Lift it' }))
    expect(useUIStore.getState().lensLifted).toBe(true)
    const back = within(tray()).getByRole('button', { name: 'Lens lifted. Put it back' })
    expect(back).toHaveAttribute('aria-pressed', 'false')
    expect(within(tray()).getByRole('button', { name: 'Lens: Focus only, lifted' })).toBeTruthy()
    expect(counter()).toHaveAccessibleName('3 of 3 open tasks shown. Show them')
    expect(useSettingsStore.getState().activeLensId).toBe('lens-f')
    fireEvent.click(back)
    expect(counter()).toHaveAccessibleName('2 of 3 open tasks shown. Show them')
  })

  it('a chip on top narrows further and turns the tray red; Clear all leaves the lens', () => {
    useSettingsStore.setState({ activeLensId: 'lens-f' })
    renderBar()
    act(() => useFilterStore.getState().setAllFilters({ ...useFilterStore.getState().filters, markers: { important: true } }))
    expect(counter()).toHaveAccessibleName('1 of 3 open tasks shown. Show them')
    expect(tray().className).toMatch(/trayActive/)
    fireEvent.click(within(tray()).getByRole('button', { name: 'Clear all filters' }))
    expect(counter()).toHaveAccessibleName('2 of 3 open tasks shown. Show them')
    expect(within(tray()).getByRole('button', { name: 'Lens: Focus only' })).toBeTruthy()
  })
})
