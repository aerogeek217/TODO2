import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { AppCommandPalette } from '../../../App'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useFilterStore } from '../../../stores/filter-store'
import { useUIStore } from '../../../stores/ui-store'
import { makePerson, makeTodo } from '../../helpers'

// JSDOM has no scrollIntoView (the palette keeps the active row in view).
const proto = Element.prototype as { scrollIntoView?: unknown }
let originalScrollIntoView: unknown

beforeEach(() => {
  originalScrollIntoView = proto.scrollIntoView
  proto.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  if (originalScrollIntoView === undefined) delete proto.scrollIntoView
  else proto.scrollIntoView = originalScrollIntoView
})

const shortcuts = { openPalette: vi.fn(), closePalette: vi.fn(), openSettings: vi.fn(), openShortcutsModal: vi.fn() }

describe('AppCommandPalette', () => {
  it('a palette opened before the tasks load gains the per-person check-ins as they arrive', () => {
    render(<AppCommandPalette onClose={vi.fn()} shortcuts={shortcuts} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'email ada' } })
    expect(screen.queryByRole('option', { name: /Email check-in: Ada Lovelace/ })).toBeNull()

    const ada = makePerson({ id: 1, name: 'Ada Lovelace' })
    act(() => {
      usePersonStore.setState({ people: [ada] })
      useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Report' })] })
      usePersonStore.setState({ assignedPeopleMap: new Map([[1, [ada]]]) })
    })
    expect(screen.getByRole('option', { name: /Email check-in: Ada Lovelace/ })).toHaveTextContent('1 open task')
  })

  it('Show Tasks Matching the Filter: always offered, counts the tasks, opens them in the task dialog', () => {
    useTodoStore.setState({ todos: [
      makeTodo({ id: 1, title: 'Report' }),
      makeTodo({ id: 2, title: 'Review' }),
      makeTodo({ id: 3, title: 'Report draft', isCompleted: true }),
    ] })
    const onClose = vi.fn()
    const { unmount } = render(<AppCommandPalette onClose={onClose} shortcuts={shortcuts} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'matching the filter' } })
    // No filter on: every open task.
    expect(screen.getByRole('option', { name: /Show Tasks Matching the Filter/ })).toHaveTextContent('2 tasks')
    unmount()

    useFilterStore.getState().setSearchText('report')
    render(<AppCommandPalette onClose={onClose} shortcuts={shortcuts} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'matching the filter' } })
    const option = screen.getByRole('option', { name: /Show Tasks Matching the Filter/ })
    expect(option).toHaveTextContent('1 task')
    fireEvent.click(option)
    expect(useUIStore.getState().taskDialog).toMatchObject({ title: 'Filtered tasks', source: { kind: 'screen' } })
  })
})
