import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { FilterChipBar } from '../../../../components/shared/filters/FilterChipBar'
import { PredicateFieldPicker } from '../../../../components/shared/filters/PredicateFieldPicker'
import { emptyPredicate, type TodoPredicate } from '../../../../models'
import type { ListFilterField } from '../../../../stores/list-widget-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useStatusStore } from '../../../../stores/status-store'
import { useTagStore } from '../../../../stores/tag-store'
import { useUIStore } from '../../../../stores/ui-store'
import { makePerson } from '../../../helpers'

/**
 * The Is / Is not toggle in the People / Status / Tags pickers — the top
 * bar's (`FilterChipBar`) and a list's filter chips (`PredicateFieldPicker`)
 * — which share one rule set (`utils/filter-negation.entityPickerSelection`).
 */

beforeEach(() => {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' }), makePerson({ id: 3, name: 'Cara' })],
    assignedPeopleMap: new Map(),
  })
  useStatusStore.setState({
    statuses: [
      { id: 1, name: 'Active', color: '#888', sortOrder: 1, icon: 'circle' },
      { id: 2, name: 'Waiting', color: '#888', sortOrder: 2, icon: 'circle' },
    ],
  })
  useTagStore.setState({ tags: [{ id: 10, name: 'work', color: '#f00' }], assignedTagsMap: new Map() })
  useUIStore.setState({ checkinDialog: null })
})
afterEach(cleanup)

/** The top bar's filters, controlled: every change is kept and shown. */
function TopBar({ initial, updates }: { initial: TodoPredicate; updates: TodoPredicate[] }) {
  const [p, setP] = useState(initial)
  return <FilterChipBar predicate={p} onChange={(next) => { updates.push(next); setP(next) }} />
}

/** A list's filter chip picker, controlled. */
function ListPicker({ field, initial, updates, adding = false }: { field: ListFilterField; initial: TodoPredicate; updates: TodoPredicate[]; adding?: boolean }) {
  const [p, setP] = useState(initial)
  return (
    <PredicateFieldPicker
      field={field}
      predicate={p}
      onChange={(next) => { updates.push(next); setP(next) }}
      at={{ x: 10, y: 10, align: 'start' }}
      adding={adding}
      onClose={() => {}}
    />
  )
}

const mode = (field: string) => screen.getByRole('radiogroup', { name: `${field}: is or is not` })
const choose = (field: string, label: 'Is' | 'Is not') => fireEvent.click(within(mode(field)).getByRole('radio', { name: label }))
/** The picker rows shown ticked (their check mark's `checked` class). */
const ticked = () => Array.from(document.querySelectorAll('label'))
  .filter((l) => /checked/.test(l.querySelector('span')?.className ?? ''))
  .map((l) => l.textContent?.trim())

describe('the top bar’s Status picker', () => {
  it('Is not keeps the ticks and writes the switch; Is takes it back', () => {
    const updates: TodoPredicate[] = []
    render(<TopBar initial={{ ...emptyPredicate(), statusIds: [2] }} updates={updates} />)
    fireEvent.click(screen.getByRole('button', { name: /^Status filter/ }))
    choose('Status', 'Is not')
    expect(updates.at(-1)).toMatchObject({ statusIds: [2], negate: { statusIds: true } })
    expect(screen.getByRole('button', { name: /^Status filter: not Waiting/ })).toBeInTheDocument()
    choose('Status', 'Is')
    expect(updates.at(-1)?.statusIds).toEqual([2])
    expect(updates.at(-1)).not.toHaveProperty('negate')
  })

  it('in Is not, Select all ticks every value and Deselect all is no filter', () => {
    const updates: TodoPredicate[] = []
    render(<TopBar initial={{ ...emptyPredicate(), statusIds: [2], negate: { statusIds: true } }} updates={updates} />)
    fireEvent.click(screen.getByRole('button', { name: /^Status filter/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(updates.at(-1)).toMatchObject({ statusIds: [0, 1, 2], negate: { statusIds: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
    expect(updates.at(-1)?.statusIds).toBeNull()
    expect(updates.at(-1)).not.toHaveProperty('negate')
  })

  it('the field’s × clears it and its switch, replacing the filter rather than patching it', () => {
    const updates: TodoPredicate[] = []
    render(<TopBar initial={{ ...emptyPredicate(), statusIds: [2], tags: [10], negate: { statusIds: true } }} updates={updates} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear status filter' }))
    expect(updates.at(-1)?.statusIds).toBeNull()
    expect(updates.at(-1)?.tags).toEqual([10])
    expect(updates.at(-1)).not.toHaveProperty('negate')
  })
})

describe('the top bar’s People picker: Email check-in for an "is not" filter', () => {
  const openPeople = (predicate: TodoPredicate) => {
    render(<FilterChipBar predicate={predicate} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /^People filter/ }))
  }

  it('is not Bob: emails the people not ticked', () => {
    openPeople({ ...emptyPredicate(), personIds: [2], negate: { personIds: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Email check-in to 2 people…' }))
    expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1, 3] })
  })

  it('is not everyone: nobody to email, a hint', () => {
    openPeople({ ...emptyPredicate(), personIds: [1, 2, 3], negate: { personIds: true } })
    expect(ticked()).toEqual(['@Alice', '@Bob', '@Cara'])
    expect(screen.getByText('Narrow to some people to email them.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Email check-in/ })).toBeNull()
  })

  it('Is not picked with nothing ticked yet: no filter, a hint', () => {
    openPeople(emptyPredicate())
    choose('People', 'Is not')
    expect(ticked()).toEqual([])
    expect(screen.getByText('Narrow to some people to email them.')).toBeInTheDocument()
  })
})

describe('a list’s People picker', () => {
  it('adding: Is shows the preview (nothing ticked) and the first tick narrows to it', () => {
    const updates: TodoPredicate[] = []
    render(<ListPicker field="people" initial={emptyPredicate()} updates={updates} adding />)
    expect(ticked()).toEqual([])
    fireEvent.click(screen.getByText('@Bob'))
    expect(updates.at(-1)?.personIds).toEqual([2])
  })

  it('Is not with nothing ticked holds the mode; ticks add; the last one removed is no filter, still Is not', () => {
    const updates: TodoPredicate[] = []
    render(<ListPicker field="people" initial={emptyPredicate()} updates={updates} adding />)
    choose('People', 'Is not')
    expect(updates).toEqual([])
    fireEvent.click(screen.getByText('@Alice'))
    expect(updates.at(-1)).toMatchObject({ personIds: [1], negate: { personIds: true } })
    fireEvent.click(screen.getByText('@Cara'))
    expect(updates.at(-1)).toMatchObject({ personIds: [1, 3], negate: { personIds: true } })
    fireEvent.click(screen.getByText('@Alice'))
    fireEvent.click(screen.getByText('@Cara'))
    expect(updates.at(-1)?.personIds).toBeNull()
    expect(updates.at(-1)).not.toHaveProperty('negate')
    expect(within(mode('People')).getByRole('radio', { name: 'Is not' })).toHaveAttribute('aria-checked', 'true')
  })

  it('Select all / Deselect all follow the mode, as in the top bar', () => {
    const updates: TodoPredicate[] = []
    render(<ListPicker field="people" initial={{ ...emptyPredicate(), personIds: [2], negate: { personIds: true } }} updates={updates} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(updates.at(-1)).toMatchObject({ personIds: [0, 1, 2, 3], negate: { personIds: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }))
    expect(updates.at(-1)?.personIds).toBeNull()
  })
})
