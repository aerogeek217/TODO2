import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { FilterSheet } from '../../components/overlays/FilterSheet'
import { useUIStore } from '../../stores/ui-store'
import { useFilterStore } from '../../stores/filter-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useStatusStore } from '../../stores/status-store'
import { makePerson } from '../helpers'

function renderSheet() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <FilterSheet />
    </MemoryRouter>,
  )
  act(() => { useUIStore.setState({ isFilterSheetOpen: true }) })
}

const input = () => screen.getByRole('textbox', { name: 'Search tasks' }) as HTMLInputElement
function type(value: string) {
  act(() => {
    input().focus()
    fireEvent.change(input(), { target: { value, selectionStart: value.length, selectionEnd: value.length } })
  })
}
const f = () => useFilterStore.getState().filters

describe('FilterSheet search tokens (D16, phone)', () => {
  beforeEach(() => {
    usePersonStore.setState({ people: [makePerson({ id: 1, name: 'Aisha Rahman' }), makePerson({ id: 2, name: 'Kai Nakamura' })] })
    useTagStore.setState({ tags: [{ id: 10, name: 'northwind', color: '#888' }] })
    useStatusStore.setState({ statuses: [] })
    useTodoStore.setState({ todos: [] })
  })

  afterEach(cleanup)

  it('overdue #northwind budget: the Dates and Tags sections carry the values, budget is the text search', () => {
    renderSheet()
    type('overdue #northwind budget')
    expect(input().value).toBe('budget')
    expect(f().searchText).toBe('budget')
    expect(f().tags).toEqual(new Set([10]))
    expect(f().dates.deadline).toEqual({ match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } })
    expect(screen.getAllByText(/before today/).length).toBeGreaterThan(0)
  })

  it('@ai opens the people popup inside the sheet; a tap adds the person', () => {
    renderSheet()
    type('budget @ai')
    // Inside the sheet, not portaled out of it.
    const popup = screen.getByRole('textbox', { name: 'Search tasks' }).closest('div')?.parentElement?.querySelector<HTMLElement>('[data-nlp-popup]') ?? null
    expect(popup).not.toBeNull()
    const option = within(popup!).getByRole('option', { name: '@Aisha Rahman' })
    fireEvent.mouseDown(option, { button: 0 })
    expect(f().personIds).toEqual(new Set([1]))
    // The words stay, the caret after them for the next word.
    expect(input().value).toBe('budget ')
    expect(f().searchText).toBe('budget')
  })

  it('an unknown @name stays words with a note', () => {
    renderSheet()
    type('@nobody ')
    expect(screen.getByRole('status')).toHaveTextContent('No person named nobody — searching the words instead')
    expect(f().searchText).toBe('nobody')
  })

  it('Backspace in the empty box takes the last token back', () => {
    renderSheet()
    type('#northwind ')
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(input().value).toBe('#northwind')
    expect(f().tags).toBeNull()
  })
})
