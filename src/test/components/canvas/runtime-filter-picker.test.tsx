import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { RuntimeFilterPicker } from '../../../components/canvas/RuntimeFilterPicker'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useProjectStore } from '../../../stores/project-store'
import { useOrgStore } from '../../../stores/org-store'
import { useStatusStore } from '../../../stores/status-store'
import { db } from '../../../data/database'
import { makePerson, makeProject, resetEntityStores } from '../../helpers'

function resetStores() {
  resetEntityStores({ todos: false, orgs: false, statuses: false })
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
    useProjectStore.setState({
      projects: [makeProject({ id: 1, canvasId: 1, name: 'Alpha' })],
    })
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <RuntimeFilterPicker
        spec={{ field: 'project' }}
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

  // Item-14 contract: the picker reads exclusively from cached Zustand stores;
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
    useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
    useProjectStore.setState({ projects: [] })
    useStatusStore.setState({ statuses: [] })
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })

    const tables = [db.people, db.orgs, db.projects, db.statuses, db.tags, db.todos] as const
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
