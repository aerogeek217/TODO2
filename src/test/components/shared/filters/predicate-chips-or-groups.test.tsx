import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { PredicateChips } from '../../../../components/shared/filters/PredicateChips'
import type { DateFilterHost } from '../../../../components/shared/filters/DateFilterPanel'
import { emptyFilterClauses, emptyPredicate, OR_GROUPS_MAX, type FilterClauses, type TodoPredicate } from '../../../../models'
import { usePersonStore } from '../../../../stores/person-store'
import { useStatusStore } from '../../../../stores/status-store'
import { useTagStore } from '../../../../stores/tag-store'
import { makePerson } from '../../../helpers'

/**
 * A list's filter chips with or groups: the words, a chip's "Another filter
 * (OR)" (the one way to make a group), a group's panel — popovers under the
 * row, on the list's filter line and in the editors (a column of rows that
 * keep the order they were added in).
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

function Harness({ initial, log, layout, dateHost }: { initial: TodoPredicate; log: TodoPredicate[]; layout?: 'line' | 'stack'; dateHost?: DateFilterHost }) {
  const [p, setP] = useState(initial)
  return <PredicateChips predicate={p} layout={layout} dateHost={dateHost} onChange={(next) => { log.push(next); setP(next) }} />
}

const clauses = (patch: Partial<FilterClauses>): FilterClauses => ({ ...emptyFilterClauses(), ...patch })
const waiting: TodoPredicate = { ...emptyPredicate(), statusIds: [2] }
const grouped: TodoPredicate = {
  ...emptyPredicate(),
  statusIds: [2],
  orGroups: [clauses({ markers: [{ values: ['focus'] }], personIds: [1] })],
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
    expect(within(plate).getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['PriorityFocus', 'PeopleAlice'])
    expect(words(container)).toEqual(['and', 'or'])
    unmount()
    const { container: flat } = render(<Harness initial={{ ...waiting, personIds: [1] }} log={[]} />)
    expect(words(flat)).toEqual([])
    expect(screen.queryByTestId('or-group')).toBeNull()
  })

  it('a chip’s "Another filter (OR)" makes it a group’s first alternative; the second pick writes both at once', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
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
      'Priority', 'Tags', 'Dates', 'Status', 'Text contains…', 'Remove groupwith its 2 filters',
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
    expect(log.at(-1)?.orGroups).toEqual([clauses({ markers: [{ values: ['focus'] }], personIds: [1], tags: [10] })])
    expect(log.at(-1)?.tags).toBeNull()
  })

  it('a chip in a group: × takes it out; the group left with one item goes, the item staying', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    fireEvent.click(within(chip(/Priority/)).getByRole('button', { name: 'Remove filter' }))
    expect(log.at(-1)).toEqual({ ...waiting, personIds: [1] })
    expect(screen.queryByTestId('or-group')).toBeNull()
    fireEvent.keyDown(chip(/People/), { key: 'Delete' })
    expect(log.at(-1)).toEqual(waiting)
  })

  it('a chip emptied in its picker: the group waits while the picker is open, and goes when it closes', () => {
    const texted: TodoPredicate = { ...waiting, orGroups: [clauses({ searchText: 'foo', personIds: [1] })] }
    const textLog: TodoPredicate[] = []
    render(<Harness initial={texted} log={textLog} />)
    fireEvent.click(chip(/Text/))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(textLog.at(-1)?.orGroups).toEqual([clauses({ personIds: [1] })])
    expect(screen.getByTestId('or-group')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bar' } })
    expect(textLog.at(-1)?.orGroups).toEqual([clauses({ searchText: 'bar', personIds: [1] })])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(textLog.at(-1)).toEqual({ ...waiting, personIds: [1] })
    expect(screen.queryByTestId('or-group')).toBeNull()
  })

  it('a group of one whose field the predicate already filters stays', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...waiting, orGroups: [clauses({ statusIds: [1] })] }} log={log} />)
    expect(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip')).toHaveTextContent('StatusActive')
    expect(log).toEqual([])
  })

  it('a chip in a group: "Another filter (OR)" adds to that group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    fireEvent.click(chip(/People/))
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
    fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: 'Tags' }))
    tick('work')
    expect(log.at(-1)?.orGroups).toHaveLength(1)
    expect(log.at(-1)?.orGroups?.[0]?.tags).toEqual([10])
  })

  it('no new group past the cap: a chip of its own offers no "Another filter (OR)"', () => {
    const full: TodoPredicate = { ...waiting, orGroups: Array.from({ length: OR_GROUPS_MAX }, () => clauses({ markers: [{ values: ['focus'] }], personIds: [1] })) }
    render(<Harness initial={full} log={[]} />)
    fireEvent.click(chip(/Status/))
    expect(screen.getByRole('dialog', { name: 'Status filter' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Another filter \(OR\)/ })).toBeNull()
  })

  it('a picker opened from + Filter (adding) has no "Another filter (OR)"', () => {
    render(<Harness initial={emptyPredicate()} log={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tags' }))
    expect(screen.queryByRole('button', { name: /Another filter \(OR\)/ })).toBeNull()
  })
})

describe('PredicateChips — a group emptied while its picker is open', () => {
  // The first group is of one clause and stays: the predicate filters on text too.
  const textThenWaiting: TodoPredicate = {
    ...emptyPredicate(),
    searchText: 'own',
    orGroups: [clauses({ searchText: 'foo' }), clauses({ statusIds: [2], personIds: [1] })],
  }

  for (const layout of ['line', 'stack'] as const) {
    it(`(${layout}) the picker stays on that group: the next edit writes it back in its place, the other group untouched`, () => {
      const log: TodoPredicate[] = []
      render(<Harness initial={textThenWaiting} log={log} layout={layout} />)
      fireEvent.click(chip(/foo/))
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
      const own = { ...waiting, searchText: 'own' }
      render(<Harness initial={{ ...own, orGroups: [clauses({ searchText: 'foo' })] }} log={log} layout={layout} />)
      fireEvent.click(chip(/foo/))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
      expect(log.at(-1)).toEqual(own)
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bar' } })
      expect(log.at(-1)).toEqual({ ...own, orGroups: [clauses({ searchText: 'bar' })] })
    })
  }

  for (const layout of ['line', 'stack'] as const) {
    it(`(${layout}) a chip of the predicate's own emptied in its picker offers no "Another filter (OR)" until it filters again`, () => {
      const log: TodoPredicate[] = []
      render(<Harness initial={{ ...waiting, searchText: 'foo' }} log={log} layout={layout} />)
      fireEvent.click(chip(/Text/))
      expect(screen.getByRole('button', { name: /Another filter \(OR\)/ })).toBeInTheDocument()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
      expect(screen.queryByRole('button', { name: /Another filter \(OR\)/ })).toBeNull()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: ' ' } })
      expect(screen.queryByRole('button', { name: /Another filter \(OR\)/ })).toBeNull()
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bar' } })
      fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
      expect(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip')).toHaveTextContent('Text“bar”')
    })
  }

  it('closing it then leaves the group out', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={textThenWaiting} log={log} layout="stack" />)
    fireEvent.click(chip(/foo/))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(screen.getAllByTestId('or-group')).toHaveLength(1)
    expect(log.at(-1)?.orGroups).toEqual([clauses({ statusIds: [2], personIds: [1] })])
  })

  it('(stack) × on an earlier group’s last chip: the open picker follows its group down', () => {
    const log: TodoPredicate[] = []
    const second = clauses({ personIds: [1], searchText: 'a' })
    const third = clauses({ statusIds: [2], searchText: 'b' })
    const three: TodoPredicate = {
      ...emptyPredicate(),
      // The first group is of one clause and stays: the predicate filters on text too.
      searchText: 'own',
      orGroups: [clauses({ searchText: 'first' }), second, third],
    }
    render(<Harness initial={three} log={log} layout="stack" />)
    fireEvent.click(chip(/People/))
    fireEvent.click(within(chip(/first/)).getByRole('button', { name: 'Remove filter' }))
    expect(log.at(-1)?.orGroups).toEqual([second, third])
    expect(screen.getByTestId('list-filter-picker')).toHaveAttribute('aria-label', 'People filter')
    tick('Bob')
    expect(log.at(-1)?.orGroups).toEqual([{ ...second, personIds: [1, 2] }, third])
  })
})

describe('PredicateChips — the editors: a column of rows, popovers under them', () => {
  it('a chip row opens its picker as a popover (no in-place expansion); a second click closes it', () => {
    render(<Harness initial={waiting} log={[]} layout="stack" />)
    const status = chip(/Status/)
    fireEvent.click(status)
    expect(status).toHaveAttribute('aria-expanded', 'true')
    const picker = screen.getByTestId('list-filter-picker')
    expect(picker).toHaveAttribute('aria-label', 'Status filter')
    expect(screen.getByTestId('filter-stack')).not.toContainElement(picker)
    fireEvent.click(status)
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(status).toHaveAttribute('aria-expanded', 'false')
  })

  it('a press on the open chip closes its popover (the outside click), and the click then leaves it closed', () => {
    render(<Harness initial={waiting} log={[]} layout="stack" />)
    const status = chip(/Status/)
    fireEvent.click(status)
    expect(screen.getByTestId('list-filter-picker')).toBeInTheDocument()
    fireEvent.mouseDown(status)
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    fireEvent.click(status)
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
  })

  it('Esc closes the picker', () => {
    render(<Harness initial={waiting} log={[]} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.keyDown(screen.getByTestId('list-filter-picker'), { key: 'Escape' })
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(chip(/Status/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('Another filter (OR) turns the chip into a group in its place, then the field’s picker on the group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...waiting, personIds: [2] }} log={log} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
    const plate = screen.getByTestId('or-group')
    expect(within(plate).getByTestId('list-filter-chip')).toHaveTextContent('StatusWaiting')
    fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: 'Tags' }))
    expect(screen.getByTestId('list-filter-picker')).toHaveAttribute('aria-label', 'Tags filter')
    tick('work')
    expect(log.at(-1)).toEqual({ ...emptyPredicate(), personIds: [2], orGroups: [clauses({ statusIds: [2], tags: [10] })] })
    // The group in the chip's place (after People, as Status was), "and" on its own row between them.
    const stack = screen.getByTestId('filter-stack')
    expect(stack.textContent).toMatch(/^PeopleBoband.*Tags.*or.*Status/)
    expect(words(stack)).toEqual(['and', 'or'])
  })

  it('after Another filter (OR), the chip in the new group opens its picker on that group; the first edit writes it', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
    fireEvent.click(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip'))
    expect(screen.getAllByTestId('or-group')).toHaveLength(1)
    expect(screen.getByTestId('list-filter-picker')).toHaveAttribute('aria-label', 'Status filter')
    expect(log).toEqual([])
    tick('Active')
    expect(log.at(-1)).toEqual({ ...emptyPredicate(), orGroups: [clauses({ statusIds: [2, 1] })] })
  })

  it('after Another filter (OR), a second click on the chip in the new group closes it and puts the chip back', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={waiting} log={log} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
    fireEvent.click(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip'))
    fireEvent.click(within(screen.getByTestId('or-group')).getByTestId('list-filter-chip'))
    expect(screen.queryByTestId('or-group')).toBeNull()
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(screen.getAllByTestId('list-filter-chip').map((c) => c.textContent)).toEqual(['StatusWaiting'])
    expect(log).toEqual([])
  })

  it('a group’s chevron opens its panel as a popover; Remove group', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} layout="stack" />)
    const toggle = within(screen.getByTestId('or-group')).getByRole('button', { name: 'Group' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByTestId('or-group-panel')
    expect(screen.getByTestId('filter-stack')).not.toContainElement(panel)
    expect(within(panel).getByText('Another filter (OR)')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: /Remove group/ }))
    expect(log.at(-1)).toEqual(waiting)
  })

  it('one popover at a time', () => {
    render(<Harness initial={grouped} log={[]} layout="stack" />)
    fireEvent.click(chip(/Status/))
    fireEvent.click(chip(/People/))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByTestId('list-filter-picker')).toHaveAttribute('aria-label', 'People filter')
  })

  it('+ Filter reads "Another filter (AND)" once a row is there (the filter line keeps "Filter")', () => {
    const { unmount } = render(<Harness initial={emptyPredicate()} log={[]} layout="stack" />)
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
    unmount()
    render(<Harness initial={waiting} log={[]} layout="stack" />)
    expect(screen.getByRole('button', { name: 'Another filter (AND)' })).toBeInTheDocument()
    cleanup()
    render(<Harness initial={waiting} log={[]} />)
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
  })
})

describe('PredicateChips — the rows keep the order they were added in', () => {
  /** The top-level rows' text: a chip, or a group as its chips run together. */
  const rowTexts = () => Array.from(screen.getByTestId('filter-stack').querySelectorAll('[data-testid="list-filter-chip"], [data-testid="or-group"]'))
    .filter((el) => el.parentElement?.closest('[data-testid="or-group"]') == null)
    .map((el) => el.textContent)
  const addFilter = (field: string) => {
    fireEvent.click(screen.getByRole('button', { name: /^(Filter|Another filter \(AND\))$/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: field }))
  }

  it('a filter added from + Filter goes last, whatever its field (the stored order puts People and Tags before Status)', () => {
    render(<Harness initial={grouped} log={[]} layout="stack" />)
    expect(rowTexts()).toEqual(['StatusWaiting', 'PriorityFocusorPeopleAlice'])
    addFilter('People')
    tick('Bob')
    expect(rowTexts()).toEqual(['StatusWaiting', 'PriorityFocusorPeopleAlice', 'PeopleBob'])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    addFilter('Tags')
    tick('work')
    expect(rowTexts()).toEqual(['StatusWaiting', 'PriorityFocusorPeopleAlice', 'PeopleBob', 'Tags#work'])
  })

  it('a chip removed then added again goes last', () => {
    render(<Harness initial={{ ...waiting, tags: [10] }} log={[]} layout="stack" />)
    expect(rowTexts()).toEqual(['Tags#work', 'StatusWaiting'])
    fireEvent.click(within(chip(/Tags/)).getByRole('button', { name: 'Remove filter' }))
    addFilter('Tags')
    tick('work')
    expect(rowTexts()).toEqual(['StatusWaiting', 'Tags#work'])
  })

  it('a group removed: the later rows keep their order', () => {
    const three: TodoPredicate = {
      ...emptyPredicate(),
      orGroups: [
        clauses({ markers: [{ values: ['focus'] }], searchText: 'a' }),
        clauses({ personIds: [1], statusIds: [1] }),
        clauses({ statusIds: [2], searchText: 'b' }),
      ],
    }
    render(<Harness initial={three} log={[]} layout="stack" />)
    addFilter('Tags')
    tick('work')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    const hotGroup = 'PriorityFocusorText“a”'
    const peopleGroup = 'PeopleAliceorStatusActive'
    const statusGroup = 'StatusWaitingorText“b”'
    expect(rowTexts()).toEqual([hotGroup, peopleGroup, statusGroup, 'Tags#work'])
    fireEvent.click(within(screen.getAllByTestId('or-group')[0]!).getByRole('button', { name: 'Group' }))
    fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: /Remove group/ }))
    expect(rowTexts()).toEqual([peopleGroup, statusGroup, 'Tags#work'])
    // × leaving the next group one item: the item keeps the group's place.
    fireEvent.click(within(chip(/People/)).getByRole('button', { name: 'Remove filter' }))
    expect(rowTexts()).toEqual(['StatusActive', statusGroup, 'Tags#work'])
  })
})

describe('PredicateChips — Dates again while a date type is free (cr25 P4b)', () => {
  const lastNot: FilterClauses['dates'] = {
    lastFollowup: { match: 'range', start: { kind: 'offset', days: -7 }, end: { kind: 'relative', token: 'today' }, not: true },
  }
  const set = { match: 'set' as const }
  const end = { match: 'range' as const, start: null, end: { kind: 'offset' as const, days: 0 } }
  const allButCompleted: FilterClauses['dates'] = { deadline: set, followup: set, lastFollowup: set, created: end, modified: end }
  const dialogTab = (name: string) => within(screen.getByRole('dialog', { name: 'Date filters' })).getByRole('tab', { name })
  const panelFields = () => within(screen.getByTestId('or-group-panel')).getAllByRole('button').map((b) => b.textContent)

  for (const layout of ['line', 'stack'] as const) {
    it(`(${layout}) a date chip's Another filter (OR) offers Dates, which opens on another type: the group of two date ranges`, () => {
      const log: TodoPredicate[] = []
      render(<Harness initial={{ ...emptyPredicate(), dates: lastNot }} log={log} layout={layout} />)
      fireEvent.click(chip(/Last follow-up/))
      fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
      expect(panelFields()).toContain('Dates')
      fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: 'Dates' }))
      // The first free type in the tabs' order — never the wrapped chip's own.
      expect(dialogTab('Due')).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(dialogTab('Next follow-up'))
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Date filters' })).getByRole('radio', { name: 'Any' }))
      expect(log).toHaveLength(1)
      expect(log[0]!.dates).toEqual({})
      expect(log[0]!.orGroups).toEqual([clauses({ dates: { ...lastNot, followup: set } })])
      expect(within(screen.getByTestId('or-group')).getAllByTestId('list-filter-chip').map((c) => c.getAttribute('data-date-field')))
        .toEqual(['followup', 'lastFollowup'])
    })
  }

  it('the wrap opens on a type other than the wrapped chip’s, even when that chip is Due', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...emptyPredicate(), dates: { deadline: set } }} log={log} />)
    fireEvent.click(chip(/Due/))
    fireEvent.click(screen.getByRole('button', { name: /Another filter \(OR\)/ }))
    fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: 'Dates' }))
    expect(dialogTab('Next follow-up')).toHaveAttribute('aria-selected', 'true')
    expect(log).toEqual([])
  })

  it('a group’s panel offers Dates while a type is free there, on the first free type', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={{ ...waiting, orGroups: [clauses({ markers: [{ values: ['focus'] }], dates: { deadline: set, followup: set } })] }} log={log} />)
    fireEvent.click(within(screen.getByTestId('or-group')).getAllByRole('button', { name: 'Group' })[0]!)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Group' })).getByRole('button', { name: 'Dates' }))
    expect(dialogTab('Last follow-up')).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Date filters' })).getByRole('radio', { name: 'Any' }))
    expect(log.at(-1)?.orGroups).toEqual([clauses({ markers: [{ values: ['focus'] }], dates: { deadline: set, followup: set, lastFollowup: set } })])
    expect(log.at(-1)?.dates).toEqual({})
  })

  it('a group with every offered type filtering doesn’t offer Dates — the host’s left-out types not counted', () => {
    const { unmount } = render(<Harness initial={{ ...waiting, orGroups: [clauses({ markers: [{ values: ['focus'] }], dates: allButCompleted })] }} log={[]} />)
    fireEvent.click(within(screen.getByTestId('or-group')).getAllByRole('button', { name: 'Group' })[0]!)
    expect(panelFields()).toContain('Dates')
    unmount()
    render(<Harness initial={{ ...waiting, orGroups: [clauses({ markers: [{ values: ['focus'] }], dates: allButCompleted })] }} log={[]} dateHost={{ omit: ['completed'] }} />)
    fireEvent.click(within(screen.getByTestId('or-group')).getAllByRole('button', { name: 'Group' })[0]!)
    expect(panelFields()).not.toContain('Dates')
  })
})

describe('PredicateChips — two rows on one filter (cr31 UI F1)', () => {
  /** The list's filter line and Edit list's Filters block, both on one predicate. */
  function TwoRows({ initial, log }: { initial: TodoPredicate; log: TodoPredicate[] }) {
    const [p, setP] = useState(initial)
    const onChange = (next: TodoPredicate) => { log.push(next); setP(next) }
    return (
      <>
        <div data-testid="line"><PredicateChips predicate={p} onChange={onChange} /></div>
        <div data-testid="editor"><PredicateChips predicate={p} onChange={onChange} layout="stack" inDialog /></div>
      </>
    )
  }
  const texted: TodoPredicate = { ...waiting, orGroups: [clauses({ searchText: '1499', personIds: [1] })] }
  const editorChip = (text: RegExp) => within(screen.getByTestId('editor')).getAllByTestId('list-filter-chip').find((c) => text.test(c.textContent ?? ''))!

  it('a group emptied to one item under the editor’s open picker stays a group: the next keystrokes fill it again (OR stays OR)', () => {
    const log: TodoPredicate[] = []
    render(<TwoRows initial={texted} log={log} />)
    fireEvent.click(editorChip(/Text/))
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: '' } })
    // The filter line, settled, leaves the group alone while the editor's picker is open on it.
    expect(log.at(-1)?.orGroups).toEqual([clauses({ personIds: [1] })])
    expect(within(screen.getByTestId('line')).getByTestId('or-group')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '1498' } })
    expect(log.at(-1)).toEqual({ ...waiting, orGroups: [clauses({ searchText: '1498', personIds: [1] })] })
    expect(log.every((p) => p.searchText === '')).toBe(true)
  })

  it('emptied and closed: the row the edit was made in dissolves the group once', () => {
    const log: TodoPredicate[] = []
    render(<TwoRows initial={texted} log={log} />)
    fireEvent.click(editorChip(/Text/))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(log.at(-1)).toEqual({ ...waiting, personIds: [1] })
    expect(screen.queryByTestId('or-group')).toBeNull()
    // One dissolve, not one per row.
    expect(log.filter((p) => p.personIds != null && (p.orGroups ?? []).length === 0)).toHaveLength(1)
  })

  it('a row with no edit of its own never dissolves a group of one it is shown', () => {
    const log: TodoPredicate[] = []
    render(<TwoRows initial={{ ...waiting, orGroups: [clauses({ personIds: [1] })] }} log={log} />)
    expect(log).toEqual([])
    expect(screen.getAllByTestId('or-group')).toHaveLength(2)
  })
})

describe('PredicateChips — a pending date Is not is kept per scope (cr31 UI F3)', () => {
  const dueSwitch = (name: 'Is' | 'Is not') => within(screen.getByRole('radiogroup', { name: 'Due: is or is not' })).getByRole('radio', { name })

  it('an Is not left pending on the predicate’s own Due doesn’t open a group’s Due panel on Is not', () => {
    const log: TodoPredicate[] = []
    render(<Harness initial={grouped} log={log} />)
    // + Filter › Dates opens on Due (free): Is not, no end yet — nothing written.
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dates' }))
    fireEvent.click(dueSwitch('Is not'))
    expect(log).toEqual([])
    fireEvent.keyDown(document.body, { key: 'Escape' })
    // The group's panel › Dates opens on its own Due: Is.
    fireEvent.click(within(screen.getByTestId('or-group')).getByRole('button', { name: 'Group' }))
    fireEvent.click(within(screen.getByTestId('or-group-panel')).getByRole('button', { name: 'Dates' }))
    expect(dueSwitch('Is')).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    // The predicate's own Due still has it pending.
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dates' }))
    expect(dueSwitch('Is not')).toHaveAttribute('aria-checked', 'true')
  })
})

describe('PredicateChips — where the focus goes when a chip does (cr31 UI F4)', () => {
  const chips = () => screen.getAllByTestId('list-filter-chip')

  it('Delete on a focused chip: the chip now in its place takes the focus; the last one gone, + Filter', () => {
    render(<Harness initial={{ ...waiting, personIds: [1] }} log={[]} layout="stack" />)
    chip(/Status/).focus()
    fireEvent.keyDown(chip(/Status/), { key: 'Delete' })
    expect(document.activeElement).toBe(chip(/People/))
    fireEvent.keyDown(chip(/People/), { key: 'Backspace' })
    expect(screen.queryAllByTestId('list-filter-chip')).toHaveLength(0)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filter' }))
  })

  it('× on the last chip: the chip before it', () => {
    render(<Harness initial={{ ...waiting, personIds: [1] }} log={[]} />)
    const remove = within(chip(/People/)).getByRole('button', { name: 'Remove filter' })
    remove.focus()
    fireEvent.click(remove)
    expect(document.activeElement).toBe(chip(/Status/))
  })

  it('a group dissolving under the focused chip: the chip, drawn in its place, keeps the focus', () => {
    render(<Harness initial={grouped} log={[]} layout="stack" />)
    chip(/Priority/).focus()
    fireEvent.keyDown(chip(/Priority/), { key: 'Delete' })
    expect(screen.queryByTestId('or-group')).toBeNull()
    expect(chips().map((c) => c.textContent)).toEqual(['StatusWaiting', 'PeopleAlice'])
    expect(document.activeElement).toBe(chip(/People/))
  })
})

describe('PredicateChips — rows keep their order (cr31 UI F5)', () => {
  const rowTexts = () => Array.from(screen.getByTestId('filter-stack').querySelectorAll('[data-testid="list-filter-chip"], [data-testid="or-group"]'))
    .filter((el) => el.parentElement?.closest('[data-testid="or-group"]') == null)
    .map((el) => el.textContent)

  it('Esc reaching close twice drops only the held group’s row: the next group keeps its place', () => {
    const p: TodoPredicate = {
      ...waiting,
      tags: [10],
      searchText: 'a',
      // A group of one on a field the predicate filters stays a group.
      orGroups: [clauses({ searchText: 'x' }), clauses({ personIds: [1], searchText: 'b' })],
    }
    render(<Harness initial={p} log={[]} layout="stack" />)
    // A chip added last, after the groups.
    fireEvent.click(screen.getByRole('button', { name: 'Another filter (AND)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'People' }))
    tick('Bob')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    const before = rowTexts()
    expect(before.slice(-3)).toEqual(['Text“x”', 'PeopleAliceorText“b”', 'PeopleBob'])
    fireEvent.click(within(screen.getAllByTestId('or-group')[0]!).getByTestId('list-filter-chip'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    // Emptied: the group is held by its picker. Esc in the field closes it.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(rowTexts()).toEqual([...before.slice(0, -3), 'PeopleAliceorText“b”', 'PeopleBob'])
  })

  it('a Priority chip emptied in its picker with later ones behind it: the later ones keep their places', () => {
    const p: TodoPredicate = {
      ...emptyPredicate(),
      markers: [{ values: ['focus'] }, { values: ['urgent'] }],
      statusIds: [2],
    }
    render(<Harness initial={p} log={[]} layout="stack" />)
    // Rows as stored: Priority, Priority, Status. Add a third Priority last.
    fireEvent.click(screen.getByRole('button', { name: 'Another filter (AND)' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }))
    tick('Important')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(rowTexts()).toEqual(['PriorityFocus', 'PriorityUrgent', 'StatusWaiting', 'PriorityImportant'])
    // The first one emptied in its picker: it goes, the picker closes.
    fireEvent.click(chip(/Focus/))
    tick('Focus')
    expect(screen.queryByTestId('list-filter-picker')).toBeNull()
    expect(rowTexts()).toEqual(['PriorityUrgent', 'StatusWaiting', 'PriorityImportant'])
  })
})
