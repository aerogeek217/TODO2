import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, screen, within, act, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { TOOLTIP_DELAY_MS } from '../../../../components/shared/use-tooltip'
import { FilterChipBar } from '../../../../components/shared/filters/FilterChipBar'
import { ADD_FILTER_ITEMS } from '../../../../components/shared/filters/filter-menu'
import type { TodoPredicate } from '../../../../models'
import { createTab } from '../../../../models/workspace-layout'
import { useStatusStore } from '../../../../stores/status-store'
import { useListWidgetStore } from '../../../../stores/list-widget-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useUIStore } from '../../../../stores/ui-store'
import { useTagStore } from '../../../../stores/tag-store'
import { useWorkspaceStore } from '../../../../stores/workspace-store'
import { emptyPredicate } from '../../../../models'
import { makePerson } from '../../../helpers'
import { cell, grid } from '../../../helpers/layout-builders'
import { filterMenuButton, openFilterMenu, openFilterPicker } from './filter-menu-helpers'

/** A row of the Priority picker. */
function priorityRow(name: string): HTMLElement {
  return screen.getByRole('option', { name: new RegExp(name) })
}

function seedStores() {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    assignedPeopleMap: new Map(),
  })
  useStatusStore.setState({
    statuses: [{ id: 1, name: 'Active', color: '#888', sortOrder: 1, icon: 'circle' }],
  })
  useTagStore.setState({
    tags: [
      { id: 10, name: 'urgent', color: '#f00' },
      { id: 20, name: 'soon', color: '#0f0' },
    ],
    assignedTagsMap: new Map(),
  })
}

describe('FilterChipBar — primitive', () => {
  beforeEach(seedStores)
  afterEach(cleanup)

  // ── Desktop density ──────────────────────────────────────────────────

  describe('desktop density', () => {
    it('at rest: the Filter button alone — no chips, no Completed, no Clear all', () => {
      const { container } = render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
      expect(filterMenuButton()).toHaveAccessibleName('Filter')
      expect(filterMenuButton()).toHaveTextContent('Filter')
      expect(filterMenuButton()).toHaveAttribute('data-filter-menu')
      expect(container.querySelectorAll('button')).toHaveLength(1)
    })

    it('Completed is a toggle row in the menu; while on, a Completed chip in the bar hides them again', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      const menu = openFilterMenu()
      const row = within(menu).getByRole('button', { name: 'Show completed' })
      expect(row).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(row)
      expect(updates.at(-1)?.showCompleted).toBe(true)
      // The menu stays open for another pick.
      expect(screen.getByRole('group', { name: 'Screen filters' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /hidden/i })).toBeNull()
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), showCompleted: true }} onChange={(p) => updates.push(p)} />)
      expect(within(menu).getByRole('button', { name: 'Show completed' })).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(filterMenuButton())
      expect(screen.queryByRole('group', { name: 'Screen filters' })).toBeNull()
      const chip = screen.getByRole('button', { name: 'Show completed' })
      expect(chip).toHaveTextContent('Completed')
      expect(chip).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(chip)
      expect(updates.at(-1)?.showCompleted).toBe(false)
    })

    it('a filter that is on shows as a chip: its value and a × that clears only that field', () => {
      const updates: TodoPredicate[] = []
      const active: TodoPredicate = { ...emptyPredicate(), personIds: [1], tags: [10, 20] }
      render(<FilterChipBar predicate={active} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('button', { name: 'People filter: Alice' })).toHaveTextContent('Alice')
      expect(screen.getByRole('button', { name: 'Tags filter: urgent or soon' })).toHaveTextContent('urgent or soon')
      // Only the fields that are on.
      expect(screen.queryByRole('button', { name: /^(Status|Dates|Priority) filter/ })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Clear people filter' }))
      expect(updates.at(-1)?.personIds).toBeNull()
      expect(updates.at(-1)?.tags).toEqual([10, 20])
      expect(screen.queryByRole('button', { name: 'Clear status filter' })).toBeNull()
    })

    it('the chips read in the menu’s order; a chip’s click reopens its picker', () => {
      const active: TodoPredicate = { ...emptyPredicate(), statusIds: [1], personIds: [1], tags: [10], markers: [{ values: ['urgent'] }], showCompleted: true }
      render(<FilterChipBar predicate={active} onChange={() => {}} />)
      expect(screen.getAllByRole('button', { name: / filter: |^Show completed$/ }).map((b) => b.getAttribute('aria-label')))
        .toEqual(['Priority filter: Urgent', 'Tags filter: urgent', 'People filter: Alice', 'Status filter: Active', 'Show completed'])
      fireEvent.click(screen.getByRole('button', { name: 'Status filter: Active' }))
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
    })

    it('a chip whose picker empties its filter stays until the picker closes', () => {
      function Live() {
        const [p, setP] = useState<TodoPredicate>({ ...emptyPredicate(), personIds: [1] })
        return <FilterChipBar predicate={p} onChange={setP} />
      }
      render(<Live />)
      fireEvent.click(screen.getByRole('button', { name: 'People filter: Alice' }))
      fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
      // Everyone: no filter, but the chip (now its label) and its picker stay.
      expect(screen.getByRole('button', { name: 'People filter' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
      fireEvent.keyDown(screen.getByPlaceholderText('Search...'), { key: 'Escape' })
      expect(screen.queryByRole('button', { name: /^People filter/ })).toBeNull()
    })

    it('the menu: a count on the button; a row opens its picker, × clears, Clear all filters', () => {
      const updates: TodoPredicate[] = []
      const active: TodoPredicate = { ...emptyPredicate(), personIds: [1], tags: [10] }
      render(<FilterChipBar predicate={active} onChange={(p) => updates.push(p)} onClearAll={() => updates.push(emptyPredicate())} />)
      expect(filterMenuButton()).toHaveAccessibleName('Filter, 2 active')
      const menu = openFilterMenu()
      expect(menu).toHaveTextContent('Screen filters · apply to every widget')
      fireEvent.click(within(menu).getByRole('button', { name: 'Status filter' }))
      fireEvent.click(screen.getByText('Active'))
      expect(updates.at(-1)?.statusIds).toEqual([1])
      fireEvent.click(within(menu).getByRole('button', { name: 'Clear tags filter' }))
      expect(updates.at(-1)?.tags).toBeNull()
      fireEvent.click(within(menu).getByRole('button', { name: 'Clear all filters' }))
      expect(updates.at(-1)).toEqual(emptyPredicate())
      expect(screen.queryByRole('group', { name: 'Screen filters' })).toBeNull()
    })

    it('the menu lists Priority, Tags, People, Dates, Status, then Completed; Clear all only while a filter is on', () => {
      render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
      const menu = openFilterMenu()
      expect(within(menu).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
        .toEqual(['Priority filter', 'Tags filter', 'People filter', 'Dates filter', 'Status filter', 'Show completed'])
      expect(within(menu).queryByRole('button', { name: 'Clear all filters' })).toBeNull()
    })

    it('folded: no chips; the button counts them in the accent', () => {
      const active: TodoPredicate = { ...emptyPredicate(), personIds: [1], showCompleted: true }
      render(<FilterChipBar predicate={active} onChange={() => {}} fold />)
      expect(screen.queryByRole('button', { name: /^People/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Show completed' })).toBeNull()
      expect(filterMenuButton()).toHaveAccessibleName('Filter, 2 active')
      expect(filterMenuButton()).toHaveTextContent('Filter2')
    })

    it('measureFold: both folds are laid out too — hidden, inert, out of the accessibility tree', () => {
      const active: TodoPredicate = { ...emptyPredicate(), personIds: [1] }
      const { container, rerender } = render(<FilterChipBar predicate={active} onChange={() => {}} measureFold valueWidths={{ people: 30 }} />)
      const variants = () => [...container.querySelectorAll<HTMLElement>('[data-fold-variant]')]
        .map((el) => ({ variant: el.dataset.foldVariant, hidden: el.hasAttribute('data-fold-hidden'), inert: el.hasAttribute('inert'), ariaHidden: el.getAttribute('aria-hidden') }))
      const hiddenFolds = [
        { variant: 'open', hidden: true, inert: true, ariaHidden: 'true' },
        { variant: 'folded', hidden: true, inert: true, ariaHidden: 'true' },
      ]
      expect(variants()).toEqual([{ variant: 'open', hidden: false, inert: false, ariaHidden: null }, ...hiddenFolds])
      // Only the shown fold is reachable, and only its Filter button is the shortcut's.
      expect(screen.getByRole('button', { name: 'People filter: Alice' })).toBeInTheDocument()
      expect(container.querySelectorAll('[data-filter-menu]')).toHaveLength(1)
      // The value is marked for the measure, cut only where shown (the hidden open fold keeps its natural width).
      const values = [...container.querySelectorAll<HTMLElement>('[data-fold-value]')]
      expect(values.map((el) => [el.dataset.foldValue, el.style.maxWidth, !!el.closest('[data-fold-hidden]')])).toEqual([
        ['people', '30px', false], ['people', '', true],
      ])

      const shownButton = filterMenuButton()
      rerender(<FilterChipBar predicate={active} onChange={() => {}} measureFold fold />)
      expect(variants()).toEqual([{ variant: 'folded', hidden: false, inert: false, ariaHidden: null }, ...hiddenFolds])
      // The same Filter button (a fold change keeps its menu).
      expect(filterMenuButton()).toBe(shownButton)
      expect(filterMenuButton()).toHaveAccessibleName('Filter, 1 active')
      expect(screen.queryByRole('button', { name: 'People filter: Alice' })).toBeNull()
      // The hidden chips carry the same labels (their width is the open tray's).
      expect(container.querySelector('[data-fold-variant="open"][data-fold-hidden]')).toHaveTextContent('Alice')
    })

    it('valueWidths: a cut value keeps its whole text in its name and shows it in a tooltip', () => {
      vi.useFakeTimers()
      try {
        const active: TodoPredicate = { ...emptyPredicate(), personIds: [1], statusIds: [1] }
        render(<FilterChipBar predicate={active} onChange={() => {}} valueWidths={{ people: 40 }} />)
        const people = screen.getByRole('button', { name: 'People filter: Alice' })
        expect(people.querySelector('[data-fold-value]')).toHaveStyle({ maxWidth: '40px' })
        fireEvent.pointerEnter(people, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        expect(screen.getByRole('tooltip')).toHaveTextContent('People: Alice')
        fireEvent.pointerLeave(people)
        // A value not cut: no tooltip.
        const status = screen.getByRole('button', { name: 'Status filter: Active' })
        expect(status.querySelector('[data-fold-value]')?.getAttribute('style')).toBeNull()
        fireEvent.pointerEnter(status, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        expect(screen.queryByRole('tooltip')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('valueWidths: a cut value whose tooltip already spells it out keeps that tooltip', () => {
      vi.useFakeTimers()
      try {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['urgent', 'important'], not: true }] }} onChange={() => {}} valueWidths={{ markers: 40 }} />)
        const button = screen.getByRole('button', { name: 'Priority filter: not Urgent or Important' })
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        const tip = screen.getByRole('tooltip').textContent ?? ''
        expect(tip).toContain('Hides tasks that are Urgent (flagged or due soon) or Important')
        expect(tip.split('not Urgent or Important')).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('without measureFold: only the shown fold, unwrapped', () => {
      const { container } = render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds: [1] }} onChange={() => {}} fold />)
      expect(container.querySelector('[data-fold-variant]')).toBeNull()
      expect(screen.queryByRole('button', { name: /^People filter/ })).toBeNull()
    })

    it('the Priority picker picks as Status does: several values OR; emptied is no filter', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      expect(screen.queryByRole('button', { name: /^Focus filter/ })).toBeNull()

      openFilterPicker('Priority filter')
      expect(screen.getByText('Urgent includes urgent by due date.')).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Is' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No priority', 'Focus', 'Urgent', 'Important'])
      fireEvent.click(priorityRow('Focus'))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['focus'] }])
      // The picker stays open for a second pick.
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['focus'] }] }} onChange={(p) => updates.push(p)} />)
      expect(priorityRow('Focus')).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(priorityRow('Important'))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['focus', 'important'] }])
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['focus', 'important'] }] }} onChange={(p) => updates.push(p)} />)
      // The chip in the bar and the menu's row.
      expect(screen.getAllByRole('button', { name: 'Priority filter: Focus or Important' })).toHaveLength(2)
      fireEvent.click(priorityRow('Focus'))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['important'] }])
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['important'] }] }} onChange={(p) => updates.push(p)} />)
      fireEvent.click(priorityRow('Important'))
      expect(updates.at(-1)?.markers).toBeNull()
    })

    it('Is not turns the ticks round, and holds until the first tick with nothing ticked', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      openFilterPicker('Priority filter')
      fireEvent.click(screen.getByRole('radio', { name: 'Is not' }))
      expect(updates).toEqual([])
      fireEvent.click(priorityRow('Urgent'))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['urgent'], not: true }])
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['urgent'], not: true }] }} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('radio', { name: 'Is' }))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['urgent'] }])
    })

    it('No priority is a choice, and Clear takes the filter away', () => {
      const updates: TodoPredicate[] = []
      render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['urgent'] }] }} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: 'Priority filter: Urgent' }))
      fireEvent.click(priorityRow('No priority'))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['urgent', 'none'] }])
      fireEvent.click(screen.getByRole('button', { name: 'Clear priority filter' }))
      expect(updates.at(-1)?.markers).toBeNull()
    })

    it('an "is not" shows in the button and its tooltip says what it hides', () => {
      vi.useFakeTimers()
      try {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: [{ values: ['important'], not: true }] }} onChange={() => {}} />)
        const button = screen.getByRole('button', { name: 'Priority filter: not Important' })
        expect(button).toHaveTextContent('not Important')
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        expect(screen.getByRole('tooltip')).toHaveTextContent('Hides tasks that are Important')
      } finally {
        vi.useRealTimers()
      }
    })

    it('opens the Tags chip and commits only the clicked tag (preview-empty)', () => {
      let captured: TodoPredicate | null = null
      render(
        <FilterChipBar
          predicate={emptyPredicate()}
          onChange={(p) => { captured = p }}
        />,
      )
      openFilterPicker('Tags filter')
      // Desktop picker enters "preview-empty" mode on open (all-selected hidden,
      // first click commits only the clicked entity). Matches the legacy
      // TopBar / ListFilterEditor semantics.
      fireEvent.click(screen.getByText('urgent'))
      expect(captured).not.toBeNull()
      expect(captured!.tags).toEqual([10])
    })

    it('the Dates row opens the date panel (a “Date filters” dialog) and writes nothing', () => {
      const updates: TodoPredicate[] = []
      render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      openFilterPicker('Dates filter')
      const dialog = screen.getByRole('dialog', { name: 'Date filters' })
      expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Due', 'Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified'])
      expect(within(dialog).getByRole('tab', { name: 'Due' })).toHaveAttribute('aria-selected', 'true')
      expect(within(dialog).getByRole('tab', { name: 'Due' })).toHaveFocus()
      for (const t of within(dialog).getAllByRole('tab')) fireEvent.click(t)
      // The row again closes it.
      fireEvent.click(within(screen.getByRole('group', { name: 'Screen filters' })).getByRole('button', { name: 'Dates filter' }))
      expect(screen.queryByRole('dialog', { name: 'Date filters' })).toBeNull()
      expect(updates).toEqual([])
    })

    it('the Dates button reads one type’s clause, two joined names, three or four as first + N', () => {
      const today = { kind: 'relative' as const, token: 'today' as const }
      const due = { match: 'range' as const, start: today, end: { kind: 'relative' as const, token: 'end-of-next-week' as const } }
      const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }
      const { rerender } = render(<FilterChipBar predicate={{ ...emptyPredicate(), dates: { deadline: due } }} onChange={() => {}} />)
      expect(screen.getByRole('button', { name: 'Dates filter: Due today – end of next week' })).toHaveTextContent('Due today – end of next week')
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), dates: { deadline: due, created } }} onChange={() => {}} />)
      const two = screen.getByRole('button', { name: 'Dates filter: Due today – end of next week; Created on or after start of month' })
      expect(two).toHaveTextContent('Due + Created')
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), dates: { deadline: due, created, followup: { match: 'set' } } }} onChange={() => {}} />)
      expect(screen.getByRole('button', { name: /^Dates filter:/ })).toHaveTextContent('Due + 2')
    })

    it('two date types: a tooltip lists each; the × clears every date type', () => {
      vi.useFakeTimers()
      try {
        const updates: TodoPredicate[] = []
        const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }
        render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds: [1], dates: { deadline: { match: 'set' }, created } }} onChange={(p) => updates.push(p)} />)
        const button = screen.getByRole('button', { name: /^Dates filter:/ })
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        const tip = screen.getByRole('tooltip')
        expect(tip).toHaveTextContent('Due: any date')
        expect(tip).toHaveTextContent('Created: on or after start of month')
        // The range's exact first day (cr25 P7): the 1st of this month, whatever today is — `MM/01` once
        // it is past, its weekday on the 1st itself.
        expect(tip).toHaveTextContent(/Created: on or after start of month · on or after (\d{2}\/01|[A-Z][a-z]{2} 1 [A-Z][a-z]{2})/)
        expect(tip).toHaveTextContent('Tasks must match both · × clears both')
        fireEvent.click(screen.getByRole('button', { name: 'Clear date filters' }))
        expect(updates.at(-1)).toMatchObject({ dates: {}, personIds: [1] })
      } finally {
        vi.useRealTimers()
      }
    })

    it('one type: no tooltip', () => {
      vi.useFakeTimers()
      try {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), dates: { deadline: { match: 'set' } } }} onChange={() => {}} />)
        fireEvent.pointerEnter(screen.getByRole('button', { name: /^Dates filter:/ }), { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        expect(screen.queryByRole('tooltip')).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('editing a second type in the panel adds its own clause; both filter (AND)', () => {
      const updates: TodoPredicate[] = []
      const start: TodoPredicate = { ...emptyPredicate(), dates: { deadline: { match: 'set' } } }
      render(<FilterChipBar predicate={start} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: /^Dates filter:/ }))
      const dialog = screen.getByRole('dialog', { name: 'Date filters' })
      expect(within(dialog).getByRole('tab', { name: 'Due, filtering' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(within(dialog).getByRole('tab', { name: 'Created' }))
      expect(updates).toEqual([])
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Calendar' }))
      expect(updates).toEqual([])
      fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-04-30' } })
      const last = updates.at(-1)!
      expect(Object.keys(last.dates)).toEqual(['deadline', 'created'])
      expect(last.dates.deadline).toEqual({ match: 'set' })
    })

    it('the menu’s Dates row shows the same value and its submenu is the date panel', () => {
      const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }
      render(<FilterChipBar predicate={{ ...emptyPredicate(), dates: { deadline: { match: 'set' }, created } }} onChange={() => {}} fold />)
      expect(filterMenuButton()).toHaveAccessibleName('Filter, 1 active')
      const menu = openFilterMenu()
      const row = within(menu).getByRole('button', { name: /^Dates filter:/ })
      expect(row).toHaveTextContent('Due + Created')
      fireEvent.click(row)
      expect(screen.getByRole('dialog', { name: 'Date filters' })).toBeInTheDocument()
    })

    it('Clear button uses onClearAll override when provided (skips onChange)', () => {
      // Item 13: TopBar/FilterSheet pass `onClearAll` so the topbar Clear path
      // routes through `useFilterStore.clearAll()` (which also drops the
      // runtime-filter slot). The FilterChipBar primitive must skip its
      // default onChange-based clear when the override is supplied.
      let cleared = 0
      let captured: TodoPredicate | null = null
      const active: TodoPredicate = { ...emptyPredicate(), showCompleted: true, personIds: [1] }
      render(
        <FilterChipBar
          predicate={active}
          onChange={(p) => { captured = p }}
          onClearAll={() => { cleared += 1 }}
          fold
        />,
      )
      openFilterMenu()
      fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
      expect(cleared).toBe(1)
      // onChange was NOT called with DEFAULT_PREDICATE — override takes over.
      expect(captured).toBeNull()
    })

    // Flip / clamp behavior is owned by `usePopoverAnchor` and verified in
    // real-browser e2e (see e2e/list-editor-dropdowns.spec.ts) — JSDOM's
    // synthetic getBoundingClientRect can't drive the hook's measurement
    // pass meaningfully (per ARCHITECTURE.md / Testing).
    it('Clear all is only in the menu: none in the bar, and no funnel that clears', () => {
      const active: TodoPredicate = { ...emptyPredicate(), showCompleted: true, personIds: [1] }
      render(<FilterChipBar predicate={active} onChange={() => {}} />)
      expect(screen.queryByRole('button', { name: /^Clear all/ })).toBeNull()
      expect(screen.queryByText('Clear all')).toBeNull()
    })

    describe('Esc in a picker’s search', () => {
      it('a chip’s picker: the first Esc empties the search, the next closes the picker', () => {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds: [1] }} onChange={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: 'People filter: Alice' }))
        const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
        fireEvent.change(search, { target: { value: 'bo' } })
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(search.value).toBe('')
        expect(screen.getByPlaceholderText('Search...')).toBe(search)
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
      })

      it('from the menu: the first Esc empties the search, the next closes the picker', () => {
        render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} fold />)
        openFilterPicker('Tags filter')
        const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
        fireEvent.change(search, { target: { value: 'ur' } })
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(search.value).toBe('')
        expect(screen.getByPlaceholderText('Search...')).toBe(search)
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
      })
    })

    describe('People picker: Review (widget feedback 2B: no check-ins here)', () => {
      const reviewFilter = () => useListWidgetStore.getState().reviewFilters.rv
      const withWidget = (has: boolean) => {
        const layout = { id: 1, name: 'Main', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0), ...grid([[cell('a', [createTab(has ? 'review' : 'notes', 'rv')])]]) }
        useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
      }

      beforeEach(() => {
        useUIStore.setState({ checkinDialog: null, checkinImportOpen: false })
        usePersonStore.setState({
          people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' }), makePerson({ id: 3, name: 'Cara' })],
        })
        withWidget(true)
      })

      // From its chip while on, else from the menu.
      const openPeople = (personIds: number[] | null) => {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds }} onChange={() => {}} />)
        if (personIds === null) openFilterPicker('People filter')
        else fireEvent.click(screen.getByRole('button', { name: /^People filter/ }))
      }

      it('narrowed to one person: Review with <name> alone (no check-ins) jumps with @<name> and closes the picker', async () => {
        openPeople([1])
        const footer = screen.getAllByRole('button', { name: /^(Review|Email check-in|Paste reply)/ }).map((b) => b.textContent)
        expect(footer).toEqual(['Review with Alice'])
        fireEvent.click(screen.getByRole('button', { name: 'Review with Alice' }))
        await waitFor(() => expect(reviewFilter()).toEqual({ expression: { kind: 'person', id: 1 }, showCompleted: false }))
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
        expect(useUIStore.getState().checkinDialog).toBeNull()
      })

      it('narrowed to several: Review N people’s tasks jumps with @A or @B (None ignored)', async () => {
        openPeople([3, 0, 1])
        expect(screen.queryByRole('button', { name: /^(Email check-in|Paste reply)/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: 'Review 2 people’s tasks' }))
        await waitFor(() => expect(reviewFilter()?.expression).toEqual({ kind: 'or', items: [{ kind: 'person', id: 1 }, { kind: 'person', id: 3 }] }))
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
      })

      it('no layout has a Review widget: no footer at all', () => {
        withWidget(false)
        openPeople([1])
        expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
        expect(screen.queryByText('Narrow to some people to review them.')).toBeNull()
      })

      it.each([
        ['no filter', null],
        ['every person', [1, 2, 3]],
        ['only None', [0]],
        ['nobody', []],
      ])('%s: a hint instead of the action', (_label, personIds) => {
        openPeople(personIds)
        expect(screen.getByText('Narrow to some people to review them.')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^(Review|Email check-in|Paste reply)/ })).toBeNull()
      })

      it('from the menu: the action closes the Filter menu too', async () => {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds: [1] }} onChange={() => {}} fold />)
        openFilterPicker('People filter: Alice')
        fireEvent.click(screen.getByRole('button', { name: 'Review with Alice' }))
        await waitFor(() => expect(reviewFilter()).toBeDefined())
        expect(screen.queryByRole('group', { name: 'Screen filters' })).toBeNull()
      })

      it('Tags and Status pickers have no such footer', () => {
        render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
        openFilterPicker('Tags filter')
        expect(screen.queryByText('Narrow to some people to review them.')).toBeNull()
      })
    })
  })
  // ── Mobile density ───────────────────────────────────────────────────

  describe('mobile density', () => {
    it('the sections read Priority, Tags, People, Dates, Status, then Show / hide', () => {
      render(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={() => {}} />)
      const headers = ['Priority', 'Tags', 'People', 'Dates', 'Status', 'Show / hide'].map((label) => screen.getByText(label))
      for (let i = 1; i < headers.length; i++) {
        expect(headers[i - 1]!.compareDocumentPosition(headers[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
    })

    it('expands the Tags accordion and toggles an entity', () => {
      let captured: TodoPredicate | null = null
      render(
        <FilterChipBar
          density="mobile"
          predicate={emptyPredicate()}
          onChange={(p) => { captured = p }}
        />,
      )
      fireEvent.click(screen.getByText('Tags'))
      fireEvent.click(screen.getByText('urgent'))
      expect(captured).not.toBeNull()
      expect(captured!.tags).not.toContain(10)
    })

    it('the Dates section shows the Dates value (nothing when off, like People / Tags / Status) and holds the date panel at touch sizes', () => {
      const updates: TodoPredicate[] = []
      const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }
      const { rerender } = render(
        <FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />,
      )
      // Not `Any`: the panel's Show › Any means "has the date" (P7–P8 review).
      expect(screen.getByText('Dates').parentElement).toHaveTextContent(/^Dates▸$/)
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('tab', { name: 'Next follow-up' }))
      expect(updates).toEqual([])
      fireEvent.click(screen.getByRole('radio', { name: 'None' }))
      expect(updates.at(-1)?.dates).toEqual({ followup: { match: 'unset' } })
      rerender(<FilterChipBar density="mobile" predicate={{ ...emptyPredicate(), dates: { deadline: { match: 'set' }, created } }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByText('Due + Created')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Clear all dates' }))
      expect(updates.at(-1)?.dates).toEqual({})
      rerender(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      expect(screen.getByText('Dates').parentElement).toHaveTextContent(/^Dates▸$/)
    })

    it('picks priorities as Status at mobile density: every row ticked is no filter, an untick narrows', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByText('Priority'))
      for (const name of ['No priority', 'Focus', 'Urgent', 'Important']) expect(screen.getByRole('checkbox', { name })).toBeChecked()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Focus' }))
      const after = updates.at(-1)!
      expect(new Set(after.markers?.[0]?.values)).toEqual(new Set(['none', 'urgent', 'important']))
      rerender(<FilterChipBar density="mobile" predicate={{ ...emptyPredicate(), markers: [{ values: ['urgent'] }] }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('checkbox', { name: 'Urgent' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Focus' })).not.toBeChecked()
      fireEvent.click(screen.getByRole('radio', { name: 'Is not' }))
      expect(updates.at(-1)?.markers).toEqual([{ values: ['urgent'], not: true }])
      rerender(<FilterChipBar density="mobile" predicate={updates.at(-1)!} onChange={(p) => updates.push(p)} />)
      // With an "is not", the section spells the filter out instead of a count.
      expect(screen.getByText('not Urgent')).toBeInTheDocument()
    })

    it('renders the show-completed switch with correct aria-label and toggles it', () => {
      const updates: TodoPredicate[] = []
      render(
        <FilterChipBar
          density="mobile"
          predicate={emptyPredicate()}
          onChange={(p) => updates.push(p)}
        />,
      )
      fireEvent.click(screen.getByText('Show / hide'))
      const switchEl = screen.getByRole('switch', { name: 'Show completed' })
      expect(switchEl).toHaveAttribute('aria-checked', 'false')
      fireEvent.click(switchEl)
      expect(updates.at(-1)?.showCompleted).toBe(true)
    })

    it('Clear all dispatches DEFAULT_PREDICATE and fires onClearExtra', () => {
      let captured: TodoPredicate | null = null
      let clearedExtra = false
      const active: TodoPredicate = { ...emptyPredicate(), showCompleted: true }
      render(
        <FilterChipBar
          density="mobile"
          predicate={active}
          onChange={(p) => { captured = p }}
          onClearExtra={() => { clearedExtra = true }}
        />,
      )
      fireEvent.click(screen.getByText('Clear all filters'))
      expect(captured).not.toBeNull()
      expect(captured!.showCompleted).toBe(false)
      expect(clearedExtra).toBe(true)
    })
  })
})

describe('+ Filter menu', () => {
  it('lists Priority, Tags, People, one Dates, Status, then text', () => {
    expect(ADD_FILTER_ITEMS.map((i) => i.label))
      .toEqual(['Priority', 'Tags', 'People', 'Dates', 'Status', 'Text contains…'])
  })
})
