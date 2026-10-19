import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { FilterChipBar } from '../../../../components/shared/filters/FilterChipBar'
import { PredicateFieldPicker } from '../../../../components/shared/filters/PredicateFieldPicker'
import { emptyPredicate, type TodoPredicate } from '../../../../models'
import type { ListFilterField } from '../../../../stores/list-widget-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useTagStore } from '../../../../stores/tag-store'
import { makePerson } from '../../../helpers'

beforeEach(() => {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    assignedPeopleMap: new Map(),
  })
  useTagStore.setState({
    tags: [{ id: 10, name: 'work', color: '#f00' }, { id: 20, name: 'home', color: '#0f0' }],
    assignedTagsMap: new Map(),
  })
})
afterEach(cleanup)

function ListPicker({ field, initial, onClose }: { field: ListFilterField; initial: TodoPredicate; onClose: () => void }) {
  const [predicate, setPredicate] = useState(initial)
  return (
    <>
      <output data-testid="text">{predicate.searchText}</output>
      <PredicateFieldPicker field={field} predicate={predicate} onChange={setPredicate} at={{ x: 10, y: 10, align: 'start' }} onClose={onClose} />
    </>
  )
}

describe('the filter pickers’ clear ×', () => {
  it('the top bar People picker: Search... gets a × while it has text; a click empties it and keeps the focus there', () => {
    render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^People filter/ }))
    const search = screen.getByPlaceholderText('Search...')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    fireEvent.change(search, { target: { value: 'ali' } })
    expect(screen.queryByText(/Bob/)).toBeNull()
    const clear = screen.getByRole('button', { name: 'Clear search' })
    expect(clear).toHaveAttribute('tabindex', '-1')
    fireEvent.click(clear)
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(screen.getByText(/Bob/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })

  it('a list’s Tags picker: the same ×, the picker stays open', () => {
    const onClose = vi.fn()
    render(<ListPicker field="tags" initial={emptyPredicate()} onClose={onClose} />)
    const search = screen.getByPlaceholderText('Search...')
    fireEvent.change(search, { target: { value: 'wo' } })
    expect(screen.queryByText(/home/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(screen.getByText(/home/)).toBeInTheDocument()
    expect(screen.getByTestId('list-filter-picker')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a list’s Text contains field: Clear text filter empties the filter and keeps the focus', () => {
    const onClose = vi.fn()
    render(<ListPicker field="text" initial={{ ...emptyPredicate(), searchText: 'report' }} onClose={onClose} />)
    const field = screen.getByLabelText('Text contains')
    expect(field).toHaveValue('report')
    const clear = screen.getByRole('button', { name: 'Clear text filter' })
    expect(clear).toHaveAttribute('tabindex', '-1')
    fireEvent.click(clear)
    expect(screen.getByTestId('text')).toHaveTextContent('')
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear text filter' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the phone sheet’s People search gets the × too', () => {
    render(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={() => {}} />)
    fireEvent.click(screen.getByText('People'))
    const search = screen.getByPlaceholderText('Search people...')
    fireEvent.change(search, { target: { value: 'bo' } })
    expect(screen.queryByText(/Alice/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
  })
})
