import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import type { Tag } from '../../../models'
import { makePerson, makeTodo } from '../../helpers'
import { SEARCH_DEBOUNCE_MS } from '../../../constants'
import { addDays, startOfToday } from '../../../utils/date'

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

const northwind: Tag = { id: 10, name: 'northwind', color: '#888' }
const input = () => screen.getByRole('textbox', { name: 'Search tasks' }) as HTMLInputElement

/** Types `value` as the whole field's text, the caret at its end. */
function type(value: string) {
  const el = input()
  act(() => {
    el.focus()
    fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
  })
}

const f = () => useFilterStore.getState().filters

describe('TopBar search tokens (D16)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const overdue = addDays(startOfToday(), -2)
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, title: 'Approve the budget', dueDate: overdue }),
        makeTodo({ id: 2, title: 'Budget memo' }),
        makeTodo({ id: 3, title: 'Northwind call', dueDate: overdue }),
      ],
    })
    usePersonStore.setState({ people: [makePerson({ id: 1, name: 'Aisha Rahman' })], assignedPeopleMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [northwind], assignedTagsMap: new Map([[1, [northwind]], [3, [northwind]]]) })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('overdue #northwind budget → the Dates and Tags chips, "budget" left in the box', () => {
    renderBar()
    type('overdue ')
    expect(input().value).toBe('')
    expect(f().dates.deadline).toEqual({ match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } })
    type('#northwind ')
    expect(f().tags).toEqual(new Set([10]))
    type('budget')
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10) })
    expect(input().value).toBe('budget')
    expect(f().searchText).toBe('budget')
    const tray = screen.getByRole('group', { name: 'Screen filters — apply to every widget' })
    expect(within(tray).getAllByText(/before today/).length).toBeGreaterThan(0)
    expect(within(tray).getAllByText(/northwind/).length).toBeGreaterThan(0)
  })

  it('the results dropdown lists the words\' matches among the tasks the chips keep', () => {
    renderBar()
    type('#northwind budget')
    // `#northwind` is complete (a space follows); `budget` is the text search.
    expect(input().value).toBe('budget')
    const listbox = screen.getByRole('listbox', { name: /search results/i })
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Approve the budget')
  })

  it('a token still being typed waits; ⏎ completes it', () => {
    renderBar()
    type('budget overdue')
    expect(f().dates).toEqual({})
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input().value).toBe('budget')
    expect(f().dates.deadline).toBeDefined()
  })

  it('Backspace in the empty box takes the last chip the box made back as its token', () => {
    renderBar()
    type('overdue #northwind ')
    expect(input().value).toBe('')
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(input().value).toBe('#northwind')
    expect(f().tags).toBeNull()
    expect(f().dates.deadline).toBeDefined()
  })

  it('Backspace leaves a chip set from its picker alone', () => {
    renderBar()
    type('#northwind ')
    act(() => { useFilterStore.getState().setTags(new Set([10, 11])) })
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(input().value).toBe('')
    expect(f().tags).toEqual(new Set([10, 11]))
  })

  it('Esc clears the box only; the chips stay', () => {
    renderBar()
    type('overdue budget')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(input().value).toBe('')
    expect(f().searchText).toBe('')
    expect(f().dates.deadline).toBeDefined()
  })

  it('Clear all empties the box with the chips', () => {
    renderBar()
    type('overdue budget')
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10) })
    act(() => { useFilterStore.getState().clearAll() })
    expect(input().value).toBe('')
  })

  it('an unknown @name stays in the box; the text search reads its name', () => {
    renderBar()
    type('@nobody report')
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10) })
    expect(input().value).toBe('@nobody report')
    expect(f().personIds).toBeNull()
    expect(f().searchText).toBe('nobody report')
  })
})

describe('TopBar search tokens: tints, the popup, the note (D16)', () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1, title: 'Report' })] })
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Aisha Rahman' }), makePerson({ id: 2, name: 'Kai Nakamura' })],
      assignedPeopleMap: new Map(),
    })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [northwind], assignedTagsMap: new Map() })
  })

  afterEach(cleanup)

  const popup = () => document.querySelector<HTMLElement>('[data-nlp-popup]')
  const mirror = () => screen.getByTestId('search-mirror')

  it('@ai opens the people popup under the box, without a Create row', () => {
    renderBar()
    type('@ai')
    const list = popup()
    expect(list).not.toBeNull()
    expect(within(list!).getAllByRole('option').map((o) => o.textContent)).toEqual(['@Aisha Rahman', '@Kai Nakamura'])
    expect(within(list!).queryByText(/Create/)).toBeNull()
    expect(mirror().querySelector('[data-tint="chip"]')?.textContent).toBe('@ai')
  })

  it('⏎ on the popup makes the highlighted person the People chip', () => {
    renderBar()
    type('@ai')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(f().personIds).toEqual(new Set([1]))
    expect(input().value).toBe('')
    expect(popup()).toBeNull()
  })

  it('a space after @ai completes it to the highlighted person', () => {
    renderBar()
    type('@ai')
    type('@ai ')
    expect(f().personIds).toEqual(new Set([1]))
    expect(input().value).toBe('')
  })

  it('Esc on the popup keeps @ai as words', () => {
    renderBar()
    type('@ai')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(popup()).toBeNull()
    expect(input().value).toBe('@ai')
    type('@ai x')
    expect(f().personIds).toBeNull()
    expect(input().value).toBe('@ai x')
  })

  it('an unknown @name: the "new" ring and the one-line note', () => {
    renderBar()
    type('@nobody report')
    expect(mirror().querySelector('[data-tint="new"]')?.textContent).toBe('@nobody')
    expect(screen.getByRole('status')).toHaveTextContent('No person named nobody — searching the words instead · Tab to the People chip to pick someone')
  })

  it('tokens tint by what they set', () => {
    renderBar()
    type('budget overdue')
    expect(mirror().querySelector('[data-tint="due"]')?.textContent).toBe('overdue')
  })

  it('Backspace puts an @ chip back with its popup', () => {
    renderBar()
    type('@aisha ')
    expect(f().personIds).toEqual(new Set([1]))
    fireEvent.keyDown(input(), { key: 'Backspace' })
    expect(input().value).toBe('@aisha')
    expect(f().personIds).toBeNull()
    expect(popup()).not.toBeNull()
  })
})
