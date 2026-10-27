import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { FilterSheet } from '../../components/overlays/FilterSheet'
import { emptyPredicate } from '../../models/filter-predicate'
import type { PersistedWorkspaceLayout } from '../../models/workspace-layout'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { makeTodo } from '../helpers'

const LAYOUT: PersistedWorkspaceLayout = { id: 1, name: 'Default', sortOrder: 0, columns: [], createdAt: new Date(0), modifiedAt: new Date(0) }
const FOCUS = { id: 'lens-f', name: 'Focus only', predicate: { ...emptyPredicate(), markers: { focus: true } } }

function renderSheet() {
  const result = render(
    <MemoryRouter initialEntries={['/']}>
      <FilterSheet />
    </MemoryRouter>,
  )
  act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })
  return result
}

describe('the phone filter sheet’s Lens section', () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'F', focus: true }), makeTodo({ id: 2, title: 'P' })] })
    useSettingsStore.setState({ lenses: [FOCUS] })
    useWorkspaceStore.setState({ working: LAYOUT, saved: LAYOUT, hydrated: true })
  })

  afterEach(cleanup)

  it('a radio list first: No lens with the open count, each lens with what it hides; a pick is the top bar’s', () => {
    renderSheet()
    const group = screen.getByRole('radiogroup', { name: 'Lens' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false])
    expect(group).toHaveTextContent('No lens2')
    expect(group).toHaveTextContent('Focus onlyPriority Focushides 1')
    expect(screen.queryByRole('button', { name: /Lift the lens/ })).toBeNull()
    // No chip and no lens: no Show N tasks foot.
    expect(screen.queryByRole('button', { name: /^Show \d+ tasks?$/ })).toBeNull()
    fireEvent.click(radios[1]!)
    expect(useSettingsStore.getState().activeLensId).toBe('lens-f')
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
    expect(screen.getByRole('button', { name: 'Show 1 task' })).toBeInTheDocument()
  })

  it('Lift the lens for now toggles the lift, the pick kept', () => {
    useSettingsStore.setState({ activeLensId: 'lens-f' })
    renderSheet()
    const lift = screen.getByRole('button', { name: /Lift the lens for now · shows all 2/ })
    expect(lift).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(lift)
    expect(useUIStore.getState().lensLifted).toBe(true)
    expect(lift).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Show 2 tasks' })).toBeInTheDocument()
    expect(useSettingsStore.getState().activeLensId).toBe('lens-f')
  })
})
