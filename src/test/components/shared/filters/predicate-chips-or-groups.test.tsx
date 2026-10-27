import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { PredicateChips } from '../../../../components/shared/filters/PredicateChips'
import { emptyFilterClauses, emptyPredicate, OR_GROUPS_MAX, type FilterClauses, type TodoPredicate } from '../../../../models'
import { usePersonStore } from '../../../../stores/person-store'
import { useStatusStore } from '../../../../stores/status-store'
import { useTagStore } from '../../../../stores/tag-store'
import { makePerson } from '../../../helpers'

/**
 * A list's filter chips with or groups: the words, a chip's "Or another
 * filter" (the one way to make a group), a group's panel — on the list's
 * filter line (popovers) and in the editors (expanding in place).
 */

beforeEach(() => {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    assignedPeopleMap: new Map(),
  })
  useStatusStore.setState({
    statuses: [
      { id: 1, name: 'Active', color: '#888', sortOrder: 1, icon: 'circle' },
      { id: 2, name: 'Waiting', color: '#888', sortOrder: 2, icon: 'circle' },
    ],
  })
  useTagStore.setState({ tags: [{ id: 10, name: 'work', color: '#f00' }], assignedTagsMap: new Map() })
})
afterEach(cleanup)

function Harness({ initial, log, layout }: { initial: TodoPredicate; log: TodoPredicate[]; layout?: 'line' | 'stack' }) {
  const [p, setP] = useState(initial)
  return <PredicateChips predicate={p} layout={layout} onChange={(next) => { log.push(next); setP(next) }} />
}

const clauses = (patch: Partial<FilterClauses>): FilterClauses => ({ ...emptyFilterClauses(), ...patch })
const waiting: TodoPredicate = { ...emptyPredicate(), statusIds: [2] }
const grouped: TodoPredicate = {
  ...emptyPredicate(),
  statusIds: [2],
  orGroups: [clauses({ markers: 'hot', personIds: [1] })],
}

const chip = (text: RegExp) => screen.getAllByTestId('list-filter-chip').find((c) => text.test(c.textContent ?? ''))!
const words = (root: HTMLElement) => Array.from(root.querySelectorAll('*'))
  .filter((el) => el.children.length === 0 && /^(and|or)$/.test(el.textContent ?? ''))
  .map((el) => el.textContent)
const tick = (name: string) => fireEvent.click(screen.getAllByRole('option').find((o) => o.textContent?.includes(name))!)

describe('PredicateChips — or groups on the filter line', () => {
  it('draws a group as a plate, "or" between its chips and "and" between items; no words without a group', () => {
    const { container, unmount } = render(<Harness initial={grouped} log={[]} />)
    const plate = screen.getByTestId('or-group')
    expect(plate).toHaveAttribute('aria-label', 'Group')
    expect(within(plate).getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['PriorityHot', 'PeopleAlice'])
    expect(words(container)).toEqual(['and', 'or'])
    unmount()
    const { container: flat } = render(<Harness initial={{ ...waiting, personIds: [1] }} log={[]} />)
    expect(words(flat)).toEqual([])
    expect(screen.queryByTestId('or-group')).toBeNull()
  })

  it('a chip’s "Or another filter" makes it a group’s first alternative; the second pick writes both at once', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Or another filter/ }))
    // Shown as a group, not written yet.
    expect(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip')).toHaveTextContent('StatusWaiting')
    expect(log).toEqual([])
    const panel = screen.getByTestId('or-group-panel')
    expect(within(panel).queryByRole('button', { name: /^Status/ })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /Remove group/ })).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: /People/ }))
    tick('Alice')
    expect(log).toHaveLength(1)
    expect(log[0]!.statusIds).toBeNull()
    expect(log[0]!.orGroups).toEqual([clauses({ statusIds: [2], personIds: [1] })])
    expect(within(screen.getByTestId('or-group')).getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['PeopleAlice', 'StatusWaiting'])
  })

  it('closing without a second pick writes nothing and the chip is back on its own', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Or another filter/ }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('or-group')).toBeNull()
    expect(screen.getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['StatusWaiting'])
    expect(log).toEqual([])
  })

  it('a group’s "or" opens its panel: the fields it can take, and Remove group with its filters', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    fireEvent.click(within(screen.getByTestId('or-group')).getByRole('button', { name: 'Group' }))
    const panel = screen.getByRole('dialog', { name: 'Group' })
    expect(within(panel).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Tags', 'Dates', 'Status', 'Text contains…', 'Remove groupwith its 2 filters',
    ])
    fireEvent.click(within(panel).getByRole('button', { name: /Remove group/ }))
    expect(log.at(-1)).toEqual(waiting)
    expect(screen.queryByTestId('or-group')).toBeNull()
  })

  it('Add another adds the picked field to the group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    fireEvent.click(within(screen.getByTestId('or-group')).getByRole('button', { name: 'Group' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Group' })).getByRole('button', { name: 'Tags' }))
    tick('work')
    expect(log.at(-1)?.orGroups).toEqual([clauses({ markers: 'hot', personIds: [1], tags: [10] })])
    expect(log.at(-1)?.tags).toBeNull()
  })

  it('a chip in a group: × takes it out; the last one takes the group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    fireEvent.click(within(chip(/Priority/)).getByRole('button', { name: 'Remove filter' }))
    expect(log.at(-1)?.orGroups).toEqual([clauses({ personIds: [1] })])
    fireEvent.keyDown(chip(/People/), { key: 'Delete' })
    expect(log.at(-1)).toEqual(waiting)
  })

  it('a chip in a group: "Or another filter" adds to that group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    fireEvent.click(chip(/People/))
    fireEvent.click(screen.getByRole('button', { name: /Or another filter/ }))
    fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: 'Tags' }))
    tick('work')
    expect(log.at(-1)?.orGroups).toHaveLength(1)
    expect(log.at(-1)?.orGroups?.[0]?.tags).toEqual([10])
  })

  it('no new group past the cap: a chip of its own offers no "Or another filter"', () => {
    const full: TodoPredicate = { ...waiting, orGroups: Array.from({ length: OR_GROUPS_MAX }, () => clauses({ markers: 'hot' })) }
    render(<Harness initial={full} log={[]} />)
    fireEvent.click(chip(/Status/))
    expect(screen.getByRole('dialog', { name: 'Status filter' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Or another filter/ })).toBeNull()
  })

  it('a picker opened from + Filter (adding) has no "Or another filter"', () => {
    render(<Harness initial={emptyPredicate()} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tags' }))
    expect(screen.queryByRole('button', { name: /Or another filter/ })).toBeNull()
  })
})

describe('PredicateChips — a group emptied while its picker is open', () => {
  const textThenWaiting: TodoPredicate = {
    ...emptyPredicate(),
    orGroups: [clauses({ searchText: 'foo' }), clauses({ statusIds: [2], personIds: [1] })],
  }

  for (const layout of ['line', 'stack'] as const) {
    it(`(${layout}) the picker stays on that group: the next edit writes it back in its place, the other group untouched`, () => {
      const log: TodoPredicate[] = []
      render(<Harness initial={textThenWaiting} log={log} layout={layout} />)
      fireEvent.click(chip(/Text/))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '' } })
      expect(log.at(-1)?.orGroups).toEqual([clauses({ statusIds: [2], personIds: [1] })])
      // The same input: the picker isn't redrawn under the typing.
      expect(screen.getByRole('textbox')).toBe(input)
      expect(screen.getAllByTestId('or-group')).toHaveLength(1)
      fireEvent.change(input, { target: { value: 'bar' } })
      expect(log.at(-1)?.orGroups).toEqual([clauses({ searchText: 'bar' }), clauses({ statusIds: [2], personIds: [1] })])
    })

    it(`(${layout}) the last group emptied keeps its picker open, as a chip of the predicate's own does`, () => {
      const log: TodoPredicate[] = []
      render(<Harness initial={{ ...waiting, orGroups: [clauses({ searchText: 'foo' })] }} log={log} layout={layout} />)
      fireEvent.click(chip(/Text/))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
      expect(log.at(-1)).toEqual(waiting)
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bar' } })
      expect(log.at(-1)).toEqual({ ...waiting, orGroups: [clauses({ searchText: 'bar' })] })
    })
  }

  it('closing it then leaves the group out', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={textThenWaiting} log={log} layout="stack" />)
    fireEvent.click(chip(/Text/))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(screen.queryByTestId('list-filter-expansion')).toBeNull()
    expect(screen.getAllByTestId('or-group')).toHaveLength(1)
    expect(log.at(-1)?.orGroups).toEqual([clauses({ statusIds: [2], personIds: [1] })])
  })

  it('(stack) × on an earlier group’s last chip: the open picker follows its group down', () => {
    const log: TodoPredicate[] = []
    const three: TodoPredicate = {
      ...emptyPredicate(),
      orGroups: [clauses({ markers: 'hot' }), clauses({ personIds: [1] }), clauses({ statusIds: [2] })],
    }
    render(<Harness initial={three} log={log} layout="stack" />)
    fireEvent.click(chip(/People/))
    fireEvent.click(within(chip(/Priority/)).getByRole('button', { name: 'Remove filter' }))
    expect(log.at(-1)?.orGroups).toEqual([clauses({ personIds: [1] }), clauses({ statusIds: [2] })])
    expect(screen.getByTestId('list-filter-expansion')).toHaveAttribute('aria-label', 'People filter')
    tick('Bob')
    expect(log.at(-1)?.orGroups).toEqual([clauses({ personIds: [1, 2] }), clauses({ statusIds: [2] })])
  })
})

describe('PredicateChips — the editors expand in place', () => {
  it('a chip row expands its picker under it; a second click collapses it', () => {
    render(<Harness initial={waiting} log={[]} layout="stack" />)
    const status = chip(/Status/)
    fireEvent.click(status)
    expect(status).toHaveAttribute('aria-expanded', 'true')
    const expansion = screen.getByTestId('list-filter-expansion')
    expect(expansion).toHaveAttribute('aria-label', 'Status filter')
    expect(screen.getByTestId('filter-stack')).toContainElement(expansion)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(status)
    expect(screen.queryByTestId('list-filter-expansion')).toBeNull()
  })

  it('Esc collapses the row (and stops there), the focus back on its chip', () => {
    render(<Harness initial={waiting} log={[]} layout="stack" />)
    fireEvent.click(chip(/Status/))
    // fireEvent returns false when the event was cancelled.
    expect(fireEvent.keyDown(screen.getByTestId('list-filter-expansion'), { key: 'Escape' })).toBe(false)
    expect(screen.queryByTestId('list-filter-expansion')).toBeNull()
    expect(document.activeElement).toBe(chip(/Status/))
  })

  it('Or another filter turns the chip into a group in place, then the field’s picker under the group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...waiting, personIds: [2] }} log={log} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Or another filter/ }))
    const plate = screen.getByTestId('or-group')
    expect(within(plate).getByTestId('list-filter-chip')).toHaveTextContent('StatusWaiting')
    fireEvent.click(within(screen.getByTestId('list-filter-expansion')).getByRole('button', { name: 'Tags' }))
    expect(screen.getByTestId('list-filter-expansion')).toHaveAttribute('aria-label', 'Tags filter')
    tick('work')
    expect(log.at(-1)).toEqual({ ...emptyPredicate(), personIds: [2], orGroups: [clauses({ statusIds: [2], tags: [10] })] })
    // One item per row, "and" on its own row between them.
    expect(words(screen.getByTestId('filter-stack'))).toEqual(['and', 'or'])
  })

  it('after Or another filter, the chip in the new group expands its picker on that group; the first edit writes it', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Or another filter/ }))
    fireEvent.click(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip'))
    expect(screen.getAllByTestId('or-group')).toHaveLength(1)
    expect(screen.getByTestId('list-filter-expansion')).toHaveAttribute('aria-label', 'Status filter')
    expect(log).toEqual([])
    tick('Active')
    expect(log.at(-1)).toEqual({ ...emptyPredicate(), orGroups: [clauses({ statusIds: [2, 1] })] })
  })

  it('after Or another filter, a second click on the chip in the new group folds it and puts the chip back', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Or another filter/ }))
    fireEvent.click(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip'))
    fireEvent.click(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip'))
    expect(screen.queryByTestId('or-group')).toBeNull()
    expect(screen.queryByTestId('list-filter-expansion')).toBeNull()
    expect(screen.getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['StatusWaiting'])
    expect(log).toEqual([])
  })

  it('a group’s chevron expands its panel; Remove group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} layout="stack" />)
    const toggle = within(screen.getByTestId('or-group')).getByRole('button', { name: 'Group' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(screen.getByTestId('list-filter-expansion')).getByRole('button', { name: /Remove group/ }))
    expect(log.at(-1)).toEqual(waiting)
  })

  it('one expansion at a time', () => {
    render(<Harness initial={grouped} log={[]} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(chip(/People/))
    expect(screen.getAllByTestId('list-filter-expansion')).toHaveLength(1)
    expect(screen.getByTestId('list-filter-expansion')).toHaveAttribute('aria-label', 'People filter')
  })
})
