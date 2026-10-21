import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { AppCommandPalette } from '../../../App'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
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
})
