import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { RuntimeFilterPicker } from '../../../components/workspace/list/RuntimeFilterPicker'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useStatusStore } from '../../../stores/status-store'
import { db } from '../../../data/database'
import { makePerson, resetEntityStores } from '../../helpers'

function resetStores() {
  resetEntityStores({ todos: false, statuses: false })
}

describe('RuntimeFilterPicker', () => {
  beforeEach(() => {
    resetStores()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders selected ids as chips and the input as the always-visible trigger', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
        makePerson({ id: 3, name: 'Carol' }),
      ],
      assignedPeopleMap: new Map(),
    })

    const onChange = vi.fn()
    const { getByLabelText, getByText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={[1, 3]}
        onChange={onChange}
      />,
    )
    // Two chips in pick order.
    expect(getByText('Alice')).toBeTruthy()
    expect(getByText('Carol')).toBeTruthy()
    // Input present and aria-labelled.
    const input = getByLabelText(/Filter tasks by person/i) as HTMLInputElement
    expect(input.tagName).toBe('INPUT')
  })

  it('opens the option list on focus and shows every option', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const { getByLabelText, queryByText, getByText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    expect(queryByText('Alice')).toBeNull()
    fireEvent.focus(getByLabelText(/Filter tasks by person/i))
    // Both options visible.
    expect(getByText('Alice')).toBeTruthy()
    expect(getByText('Bob')).toBeTruthy()
  })

  it('filters options by the search text the user types', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const { getByLabelText, queryByText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    const input = getByLabelText(/Filter tasks by person/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'al' } })
    // Only Alice matches.
    expect(queryByText('Alice')).toBeTruthy()
    expect(queryByText('Bob')).toBeNull()
  })

  it('toggles options through onChange when an option is clicked', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const onChange = vi.fn()
    const { getByLabelText, getByText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={[1]}
        onChange={onChange}
      />,
    )
    fireEvent.focus(getByLabelText(/Filter tasks by person/i))
    fireEvent.click(getByText('Bob'))
    expect(onChange).toHaveBeenLastCalledWith([1, 2])
  })

  it('a pick with search text clears it: the focus stays in the field, every option shows again', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const onChange = vi.fn()
    const { getByLabelText, getByRole, queryByRole } = render(
      <RuntimeFilterPicker spec={{ field: 'person' }} value={undefined} onChange={onChange} />,
    )
    const input = getByLabelText(/Filter tasks by person/i) as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'bo' } })
    expect(queryByRole('option', { name: 'Alice' })).toBeNull()
    const bob = getByRole('option', { name: 'Bob' })
    // The press keeps the focus in the field.
    expect(fireEvent.mouseDown(bob)).toBe(false)
    fireEvent.click(bob)
    expect(onChange).toHaveBeenLastCalledWith([2])
    expect(input.value).toBe('')
    expect(input).toHaveFocus()
    expect(getByRole('option', { name: 'Alice' })).toBeTruthy()
  })

  it('removes an id when the chip × is clicked', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={[1, 2]}
        onChange={onChange}
      />,
    )
    fireEvent.click(getByLabelText('Remove Alice'))
    expect(onChange).toHaveBeenLastCalledWith([2])
  })

  it('a × at the field’s end clears every pick at once, keeping the focus in the field', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const onChange = vi.fn()
    const { getByLabelText, rerender, queryByLabelText } = render(
      <RuntimeFilterPicker spec={{ field: 'person' }} value={[1, 2]} onChange={onChange} />,
    )
    const clear = getByLabelText('Clear Person')
    expect(clear.getAttribute('title')).toBe('Clear Person')
    // Not a Tab stop, and its press doesn't take the focus.
    expect(clear.tabIndex).toBe(-1)
    expect(fireEvent.mouseDown(clear)).toBe(false)
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(document.activeElement).toBe(getByLabelText(/Filter tasks by person/i))

    // No picks (or only picks whose entity is gone): no ×.
    rerender(<RuntimeFilterPicker spec={{ field: 'person' }} value={[]} onChange={onChange} />)
    expect(queryByLabelText('Clear Person')).toBeNull()
    rerender(<RuntimeFilterPicker spec={{ field: 'person' }} value={[99]} onChange={onChange} />)
    expect(queryByLabelText('Clear Person')).toBeNull()
  })

  it('subscribes to the tag store when the spec field is "tag"', () => {
    useTagStore.setState({
      tags: [
        { id: 10, name: 'urgent', color: '#fff' },
        { id: 11, name: 'someday', color: '#fff' },
      ],
      assignedTagsMap: new Map(),
    })
    const { getByLabelText, getByText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'tag' }}
        value={undefined}
        onChange={vi.fn()}
      />,
    )
    fireEvent.focus(getByLabelText(/Filter tasks by tag/i))
    expect(getByText('urgent')).toBeTruthy()
    expect(getByText('someday')).toBeTruthy()
  })

  it('emits an empty array when the last chip is removed (parent normalizes to no-pick)', () => {
    useTagStore.setState({
      tags: [{ id: 1, name: 'Alpha', color: '#fff' }],
      assignedTagsMap: new Map(),
    })
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'tag' }}
        value={[1]}
        onChange={onChange}
      />,
    )
    fireEvent.click(getByLabelText('Remove Alpha'))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('Backspace on an empty input pops the most recent chip', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={[1, 2]}
        onChange={onChange}
      />,
    )
    const input = getByLabelText(/Filter tasks by person/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onChange).toHaveBeenLastCalledWith([1])
  })

  describe('the keyboard', () => {
    const people = () => {
      usePersonStore.setState({
        people: [
          makePerson({ id: 1, name: 'Alice' }),
          makePerson({ id: 2, name: 'Alan' }),
          makePerson({ id: 3, name: 'Bob' }),
        ],
        assignedPeopleMap: new Map(),
      })
    }
    /** The picker with its value held, as the list widget holds it. */
    function Held({ initial = [], onChange }: { initial?: number[]; onChange: (ids: number[]) => void }) {
      const [ids, setIds] = useState<number[]>(initial)
      return <RuntimeFilterPicker spec={{ field: 'person' }} value={ids} onChange={(next) => { onChange(next); setIds(next) }} />
    }
    const setup = (initial?: number[]) => {
      people()
      const onChange = vi.fn()
      const utils = render(<Held initial={initial} onChange={onChange} />)
      const input = utils.getByRole('combobox', { name: /Filter tasks by person/i }) as HTMLInputElement
      act(() => input.focus())
      // The highlighted option's name (its avatar's initials left out).
      const highlighted = () => {
        const id = input.getAttribute('aria-activedescendant')
        return id ? document.getElementById(id)?.lastElementChild?.textContent : null
      }
      return { ...utils, input, onChange, highlighted }
    }

    it('is a combobox over a multi-select listbox; nothing is highlighted until a query or an arrow', () => {
      const { input, getByRole, highlighted } = setup([3])
      expect(input).toHaveAttribute('aria-expanded', 'true')
      const list = getByRole('listbox', { name: 'Person' })
      expect(list).toHaveAttribute('aria-multiselectable', 'true')
      expect(input.getAttribute('aria-controls')).toBe(list.id)
      expect(getByRole('option', { name: 'Bob' })).toHaveAttribute('aria-selected', 'true')
      expect(getByRole('option', { name: 'Alice' })).toHaveAttribute('aria-selected', 'false')
      expect(highlighted()).toBeNull()
    })

    it('a query highlights the first match; ↓ / ↑ move the highlight, wrapping', () => {
      const { input, getByRole, highlighted } = setup()
      fireEvent.change(input, { target: { value: 'al' } })
      // Sorted by name: Alan, Alice.
      expect(highlighted()).toBe('Alan')
      expect(getByRole('option', { name: 'Alan' }).className).toMatch(/active/)
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(highlighted()).toBe('Alice')
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(highlighted()).toBe('Alan')
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      expect(highlighted()).toBe('Alice')
    })

    it('with no query, ↓ starts at the first option and ↑ at the last', () => {
      const { input, highlighted } = setup()
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(highlighted()).toBe('Alan')
      fireEvent.keyDown(input, { key: 'Escape' })
      act(() => input.focus())
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      expect(highlighted()).toBe('Bob')
    })

    it('Enter toggles the highlighted option; the query clears and the option stays highlighted', () => {
      const { input, onChange, highlighted } = setup()
      fireEvent.change(input, { target: { value: 'bo' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChange).toHaveBeenLastCalledWith([3])
      expect(input.value).toBe('')
      expect(input).toHaveFocus()
      expect(highlighted()).toBe('Bob')
      // Enter again unpicks it.
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onChange).toHaveBeenLastCalledWith([])
    })

    it('Tab with a query adds the highlighted option, never removes it; the query clears and the focus stays', () => {
      const { input, onChange } = setup([3])
      fireEvent.change(input, { target: { value: 'ali' } })
      const tab = fireEvent.keyDown(input, { key: 'Tab' })
      expect(tab).toBe(false)
      expect(onChange).toHaveBeenLastCalledWith([3, 1])
      expect(input.value).toBe('')
      expect(input).toHaveFocus()
      // Bob is picked already: Tab keeps him picked (no change), the query clears.
      onChange.mockClear()
      fireEvent.change(input, { target: { value: 'bob' } })
      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false)
      expect(onChange).not.toHaveBeenCalled()
      expect(input.value).toBe('')
    })

    it('Tab / Shift+Tab with no query, Shift+Tab with one, or Tab with no match move on as usual', () => {
      const { input, onChange } = setup()
      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true)
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true)
      fireEvent.change(input, { target: { value: 'al' } })
      expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true)
      fireEvent.change(input, { target: { value: 'zz' } })
      expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  // Contract: the picker reads exclusively from cached Zustand stores;
  // mounting and typing must not issue Dexie reads. Spy on every entity table
  // the picker could plausibly touch (`toArray` covers the `useXxxStore.ensureLoaded`
  // path; `where`/`get` cover incidental id-keyed lookups), then assert no spy
  // fires across mount + focus + keystrokes + option toggle.
  it('does not hit Dexie on mount, focus, keystrokes, or option toggle', () => {
    usePersonStore.setState({
      people: [
        makePerson({ id: 1, name: 'Alice' }),
        makePerson({ id: 2, name: 'Bob' }),
      ],
      assignedPeopleMap: new Map(),
    })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })

    const tables = [db.people, db.statuses, db.tags, db.todos] as const
    const methods = ['toArray', 'where', 'get', 'count', 'each', 'bulkGet', 'orderBy'] as const
    const spies = tables.flatMap((t) =>
      methods.map((m) => vi.spyOn(t as unknown as Record<string, () => unknown>, m)),
    )

    const onChange = vi.fn()
    const { getByLabelText, getByText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'person' }}
        value={undefined}
        onChange={onChange}
      />,
    )
    const input = getByLabelText(/Filter tasks by person/i) as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'al' } })
    fireEvent.click(getByText('Alice'))

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    spies.forEach((s) => s.mockRestore())
  })
})
