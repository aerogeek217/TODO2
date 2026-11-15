import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { TOP_BAR_FILTER_PLACEHOLDER } from '../../../components/layout/TopBarFilterField'
import { EXPRESSION_WRITE_MS } from '../../../hooks/use-expression-field'
import { useFilterStore } from '../../../stores/filter-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import type { Status, Tag } from '../../../models'
import { makePerson, makeTodo } from '../../helpers'
import { addDays, startOfToday } from '../../../utils/date'

/**
 * The top bar's typed filter (feedback P2, board Filter-B): the list
 * Expression grammar and the search box's forms, applied once the text
 * reads (a pause, ⏎, blur) — the chips it can say as chips, the rest as the
 * screen filter's expression; a text that doesn't read is never applied.
 * At rest each term is a pill with its own ×.
 */

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

const northwind: Tag = { id: 10, name: 'northwind', color: '#888' }
const q4: Tag = { id: 11, name: 'q4', color: '#888' }
const waiting: Status = { id: 3, name: 'Waiting', color: '#aa0', sortOrder: 0 }
const input = () => screen.getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement
const tray = () => screen.getByRole('group', { name: 'Screen filters — apply to every widget' })

/** Types `value` as the whole field's text, the caret at its end. */
function type(value: string) {
  const el = input()
  act(() => {
    el.focus()
    fireEvent.change(el, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
  })
}

/** Typing rests: what reads is applied. */
const rest = () => act(() => { vi.advanceTimersByTime(EXPRESSION_WRITE_MS + 10) })

const f = () => useFilterStore.getState().filters

describe('TopBar typed filter (P2)', () => {
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
    usePersonStore.setState({
      people: [makePerson({ id: 1, name: 'Aisha Rahman' }), makePerson({ id: 2, name: 'Ben' })],
      assignedPeopleMap: new Map(),
    })
    useStatusStore.setState({ statuses: [waiting] })
    useTagStore.setState({ tags: [northwind, q4], assignedTagsMap: new Map([[1, [northwind]], [3, [northwind]]]) })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('says what may be typed while empty', () => {
    renderBar()
    expect(input().placeholder).toBe(TOP_BAR_FILTER_PLACEHOLDER)
    expect(TOP_BAR_FILTER_PLACEHOLDER).toBe('@person #tag due fri')
  })

  it('the search box’s forms become chips once typing rests; the text stays as typed', () => {
    renderBar()
    type('overdue #northwind budget')
    expect(f().dates).toEqual({})
    rest()
    expect(f().dates.deadline).toEqual({ match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } })
    expect(f().tags).toEqual(new Set([10]))
    expect(f().searchText).toBe('budget')
    expect(f().expression).toBeUndefined()
    expect(input().value).toBe('overdue #northwind budget')
  })

  it('an or, a not or brackets: held as the screen filter’s expression beside the chips', () => {
    renderBar()
    type('#northwind and (@Aisha or !Waiting)')
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(f().tags).toEqual(new Set([10]))
    expect(f().expression).toEqual({ kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'status', id: 3 }] })
    // ⏎ shows it settled.
    expect(input().value).toBe('#northwind and (@"Aisha Rahman" or !Waiting)')
  })

  it('a text that doesn’t read is never applied: its error under the field, the last filter kept; Esc puts it back', () => {
    renderBar()
    type('#northwind')
    rest()
    type('#northwind and (@Aisha or')
    rest()
    expect(f().tags).toEqual(new Set([10]))
    expect(f().expression).toBeUndefined()
    expect(screen.getByTestId('top-bar-filter-error')).toBeInTheDocument()
    expect(input()).toHaveAttribute('aria-invalid', 'true')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(input().value).toBe('#northwind')
    expect(screen.queryByTestId('top-bar-filter-error')).toBeNull()
  })

  it('at rest each term is a pill with its own ×; a × takes that term out', () => {
    renderBar()
    act(() => useFilterStore.getState().applyExpression({
      kind: 'and',
      items: [{ kind: 'tag', id: 10 }, { kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'tag', id: 11 }] }],
    }, false))
    const pills = within(tray()).getByTestId('top-bar-pills')
    expect([...pills.querySelectorAll('[data-top-bar-pill]')].map((p) => p.getAttribute('data-top-bar-pill')))
      .toEqual(['#northwind', '@"Aisha Rahman"', '#q4'])
    expect(pills).toHaveTextContent('#northwind× and (@"Aisha Rahman"× or #q4×)')
    fireEvent.click(within(pills).getByRole('button', { name: 'Remove #q4' }))
    // The or left with one term: a chip now.
    expect(f().tags).toEqual(new Set([10]))
    expect(f().personIds).toEqual(new Set([1]))
    expect(f().expression).toBeUndefined()
    expect([...within(tray()).getByTestId('top-bar-pills').querySelectorAll('[data-top-bar-pill]')].map((p) => p.textContent))
      .toEqual(['#northwind×', '@"Aisha Rahman"×'])
  })

  it('a focus shows the whole filter as text — chips printed as their terms — and Escape leaves the field', () => {
    renderBar()
    act(() => {
      useFilterStore.getState().setTags(new Set([10]))
      useFilterStore.getState().setShowCompleted(true)
    })
    expect(within(tray()).getByTestId('top-bar-pills')).toBeInTheDocument()
    act(() => input().focus())
    expect(within(tray()).queryByTestId('top-bar-pills')).toBeNull()
    expect(input().value).toBe('#northwind and done')
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(document.activeElement).not.toBe(input())
    expect(f().tags).toEqual(new Set([10]))
  })

  it('the results dropdown lists the words’ matches among the tasks the rest of the filter keeps', () => {
    renderBar()
    type('#northwind budget')
    rest()
    const listbox = screen.getByRole('listbox', { name: /search results/i })
    const options = within(listbox).getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Approve the budget')
  })

  it('the funnel clears the typed expression and its text with every chip', () => {
    renderBar()
    type('@Aisha or #q4')
    rest()
    expect(f().expression).toBeDefined()
    act(() => input().blur())
    fireEvent.click(within(tray()).getByRole('button', { name: 'Clear all filters' }))
    expect(f().expression).toBeUndefined()
    expect(useFilterStore.getState().isActive).toBe(false)
    expect(input().value).toBe('')
  })
})
