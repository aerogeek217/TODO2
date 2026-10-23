import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, screen, within, act } from '@testing-library/react'
import { TOOLTIP_DELAY_MS } from '../../../../components/shared/use-tooltip'
import { FilterChipBar } from '../../../../components/shared/filters/FilterChipBar'
import { ADD_FILTER_ITEMS } from '../../../../components/shared/filters/filter-menu'
import type { TodoPredicate } from '../../../../models'
import { useStatusStore } from '../../../../stores/status-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useUIStore } from '../../../../stores/ui-store'
import { useTagStore } from '../../../../stores/tag-store'
import { emptyPredicate } from '../../../../models'
import { makePerson } from '../../../helpers'

/** A marker's Any / Yes / No segment in the Priority picker. */
function markerChoice(marker: string, choice: 'Any' | 'Yes' | 'No'): HTMLElement {
  return within(screen.getByRole('radiogroup', { name: marker })).getByRole('radio', { name: choice })
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
    it('offers Show completed but no show-hidden toggle', () => {
      const updates: TodoPredicate[] = []
      render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      const toggle = screen.getByRole('button', { name: 'Show completed' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      fireEvent.click(toggle)
      expect(updates.at(-1)?.showCompleted).toBe(true)
      expect(screen.queryByRole('button', { name: /hidden/i })).toBeNull()
    })

    it('an active filter button shows its value and a × that clears only that field', () => {
      const updates: TodoPredicate[] = []
      const active: TodoPredicate = { ...emptyPredicate(), personIds: [1], tags: [10, 20] }
      render(<FilterChipBar predicate={active} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('button', { name: 'People filter: Alice' })).toHaveTextContent('Alice')
      expect(screen.getByRole('button', { name: 'Tags filter: urgent +1' })).toHaveTextContent('urgent +1')
      fireEvent.click(screen.getByRole('button', { name: 'Clear people filter' }))
      expect(updates.at(-1)?.personIds).toBeNull()
      expect(updates.at(-1)?.tags).toEqual([10, 20])
      expect(screen.queryByRole('button', { name: 'Clear status filter' })).toBeNull()
    })

    it('folded: one Filters menu with a count; a row opens its picker, × clears, Clear all filters', () => {
      const updates: TodoPredicate[] = []
      const active: TodoPredicate = { ...emptyPredicate(), personIds: [1], tags: [10] }
      render(<FilterChipBar predicate={active} onChange={(p) => updates.push(p)} onClearAll={() => updates.push(emptyPredicate())} fold />)
      expect(screen.queryByRole('button', { name: /^People/ })).toBeNull()
      expect(screen.getByRole('button', { name: 'Show completed' })).toHaveTextContent('Completed')
      fireEvent.click(screen.getByRole('button', { name: 'Filters, 2 active' }))
      const menu = screen.getByRole('group', { name: 'Screen filters' })
      expect(menu).toHaveTextContent('Screen filters · apply to every widget')
      fireEvent.click(screen.getByRole('button', { name: 'Status filter' }))
      fireEvent.click(screen.getByText('Active'))
      expect(updates.at(-1)?.statusIds).toEqual([1])
      fireEvent.click(screen.getByRole('button', { name: 'Clear tags filter' }))
      expect(updates.at(-1)?.tags).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
      expect(updates.at(-1)).toEqual(emptyPredicate())
    })

    it('the filter buttons read Markers, Tags, People, Dates, Status', () => {
      render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
      expect(screen.getAllByRole('button', { name: / filter$/ }).map((b) => b.getAttribute('aria-label')))
        .toEqual(['Priority filter', 'Tags filter', 'People filter', 'Dates filter', 'Status filter'])
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
      // Only the shown fold is reachable.
      expect(screen.getByRole('button', { name: 'People filter: Alice' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Filters/ })).toBeNull()
      // The value is marked for the measure, cut only where shown (the hidden open fold keeps its natural width).
      const values = [...container.querySelectorAll<HTMLElement>('[data-fold-value]')]
      expect(values.map((el) => [el.dataset.foldValue, el.style.maxWidth, !!el.closest('[data-fold-hidden]')])).toEqual([
        ['people', '30px', false], ['people', '', true],
      ])

      rerender(<FilterChipBar predicate={active} onChange={() => {}} measureFold fold />)
      expect(variants()).toEqual([{ variant: 'folded', hidden: false, inert: false, ariaHidden: null }, ...hiddenFolds])
      expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'People filter: Alice' })).toBeNull()
      // The hidden buttons carry the same labels (their width is the open tray's).
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
        render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { urgent: true, important: false } }} onChange={() => {}} valueWidths={{ markers: 40 }} />)
        const button = screen.getByRole('button', { name: 'Priority filter: Urgent, not Important' })
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        const tip = screen.getByRole('tooltip').textContent ?? ''
        expect(tip).toContain('Hides tasks that are Important')
        expect(tip.split('Urgent, not Important')).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('without measureFold: only the shown fold, unwrapped', () => {
      const { container } = render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} fold />)
      expect(container.querySelector('[data-fold-variant]')).toBeNull()
      expect(screen.queryByRole('button', { name: 'People filter' })).toBeNull()
    })

    it('folded: the Filters menu lists the same order', () => {
      render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} fold />)
      fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
      const menu = screen.getByRole('group', { name: 'Screen filters' })
      expect(within(menu).getAllByRole('button', { name: / filter$/ }).map((b) => b.getAttribute('aria-label')))
        .toEqual(['Priority filter', 'Tags filter', 'People filter', 'Dates filter', 'Status filter'])
    })

    it('the Priority button sets each marker to Any / Yes / No (AND); Any on the last clears it', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      expect(screen.queryByRole('button', { name: /^Focus filter/ })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Priority filter' }))
      expect(screen.getByText(/Yes: tasks must have it\. No: tasks must not\./)).toBeInTheDocument()
      for (const marker of ['Focus', 'Urgent', 'Important']) expect(markerChoice(marker, 'Any')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(markerChoice('Focus', 'Yes'))
      expect(updates.at(-1)?.markers).toEqual({ focus: true })
      // The picker stays open for a second pick.
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { focus: true } }} onChange={(p) => updates.push(p)} />)
      expect(markerChoice('Focus', 'Yes')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(markerChoice('Important', 'No'))
      expect(updates.at(-1)?.markers).toEqual({ focus: true, important: false })
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { focus: true, important: false } }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('button', { name: 'Priority filter: Focus, not Important' })).toBeInTheDocument()
      expect(markerChoice('Important', 'No')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(markerChoice('Focus', 'Any'))
      expect(updates.at(-1)?.markers).toEqual({ important: false })
      fireEvent.click(screen.getByRole('button', { name: 'Clear priority filter' }))
      expect(updates.at(-1)?.markers).toBeNull()
    })

    it('arrow keys move a marker between Any, Yes and No', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: 'Priority filter' }))
      fireEvent.keyDown(markerChoice('Urgent', 'Any'), { key: 'ArrowLeft' })
      expect(updates.at(-1)?.markers).toEqual({ urgent: false })
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { urgent: false } }} onChange={(p) => updates.push(p)} />)
      expect(markerChoice('Urgent', 'No')).toHaveAttribute('tabindex', '0')
      fireEvent.keyDown(markerChoice('Urgent', 'No'), { key: 'ArrowRight' })
      expect(updates.at(-1)?.markers).toBeNull()
    })

    it('a Priority No shows in the button and its tooltip says what it hides', () => {
      vi.useFakeTimers()
      try {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { urgent: true, important: false } }} onChange={() => {}} />)
        const button = screen.getByRole('button', { name: 'Priority filter: Urgent, not Important' })
        expect(button).toHaveTextContent('Urgent, not Important')
        fireEvent.pointerEnter(button, { pointerType: 'mouse' })
        act(() => { vi.advanceTimersByTime(TOOLTIP_DELAY_MS) })
        expect(screen.getByRole('tooltip')).toHaveTextContent('Hides tasks that are Important')
      } finally {
        vi.useRealTimers()
      }
    })

    it('Hot comes first; ticking it replaces the single markers and greys them out', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { urgent: true } }} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: 'Priority filter: Urgent' }))
      expect(screen.getAllByRole('checkbox').map((c) => c.textContent)).toEqual(['Hot'])
      expect(screen.getAllByRole('radiogroup').map((g) => g.getAttribute('aria-label'))).toEqual(['Focus', 'Urgent', 'Important'])
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hot' }))
      expect(updates.at(-1)?.markers).toBe('hot')

      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: 'hot' }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('button', { name: 'Priority filter: Hot' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Hot' })).toHaveAttribute('aria-checked', 'true')
      for (const name of ['Urgent', 'Important', 'Focus']) {
        expect(screen.getByRole('radiogroup', { name })).toHaveAttribute('aria-disabled', 'true')
        expect(markerChoice(name, 'Any')).toHaveAttribute('aria-checked', 'true')
      }
      expect(screen.getByText('Hot already combines these. Clear Hot to pick them one by one.')).toBeInTheDocument()
      const before = updates.length
      fireEvent.click(markerChoice('Important', 'Yes'))
      fireEvent.keyDown(markerChoice('Important', 'Any'), { key: 'ArrowRight' })
      expect(updates.length).toBe(before)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hot' }))
      expect(updates.at(-1)?.markers).toBeNull()
    })

    it('opens the Tags chip and commits only the clicked tag (preview-empty)', () => {
      let captured: TodoPredicate | null = null
      render(
        <FilterChipBar
          predicate={emptyPredicate()}
          onChange={(p) => { captured = p }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Tags/i }))
      // Desktop chip enters "preview-empty" mode on open (all-selected hidden,
      // first click commits only the clicked entity). Matches the legacy
      // TopBar / ListFilterEditor semantics.
      fireEvent.click(screen.getByText('#urgent'))
      expect(captured).not.toBeNull()
      expect(captured!.tags).toEqual([10])
    })

    it('the Dates button opens the date panel (a “Date filters” dialog) and writes nothing', () => {
      const updates: TodoPredicate[] = []
      render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      const button = screen.getByRole('button', { name: 'Dates filter' })
      fireEvent.click(button)
      const dialog = screen.getByRole('dialog', { name: 'Date filters' })
      expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Due', 'Follow-up', 'Created', 'Modified'])
      expect(within(dialog).getByRole('tab', { name: 'Due' })).toHaveAttribute('aria-selected', 'true')
      expect(within(dialog).getByRole('tab', { name: 'Due' })).toHaveFocus()
      for (const t of within(dialog).getAllByRole('tab')) fireEvent.click(t)
      fireEvent.click(button)
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
      const two = screen.getByRole('button', { name: 'Dates filter: Due today – end of next week; Created from start of month' })
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
        expect(tip).toHaveTextContent('Due: has a date')
        expect(tip).toHaveTextContent('Created: from start of month')
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
      fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-04-30' } })
      const last = updates.at(-1)!
      expect(Object.keys(last.dates)).toEqual(['deadline', 'created'])
      expect(last.dates.deadline).toEqual({ match: 'set' })
    })

    it('folded: the Dates row shows the same value and its submenu is the date panel', () => {
      const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }
      render(<FilterChipBar predicate={{ ...emptyPredicate(), dates: { deadline: { match: 'set' }, created } }} onChange={() => {}} fold />)
      fireEvent.click(screen.getByRole('button', { name: 'Filters, 1 active' }))
      const menu = screen.getByRole('group', { name: 'Screen filters' })
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
      fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }))
      expect(cleared).toBe(1)
      // onChange was NOT called with DEFAULT_PREDICATE — override takes over.
      expect(captured).toBeNull()
    })

    // Flip / clamp behavior is owned by `usePopoverAnchor` and verified in
    // real-browser e2e (see e2e/list-editor-dropdowns.spec.ts) — JSDOM's
    // synthetic getBoundingClientRect can't drive the hook's measurement
    // pass meaningfully (per ARCHITECTURE.md / Testing).
    it('has no Clear all button of its own (the top bar’s funnel clears)', () => {
      const active: TodoPredicate = { ...emptyPredicate(), showCompleted: true, personIds: [1] }
      render(<FilterChipBar predicate={active} onChange={() => {}} />)
      expect(screen.queryByRole('button', { name: /^Clear all/ })).toBeNull()
      expect(screen.queryByText('Clear all')).toBeNull()
    })

    describe('Esc in a picker’s search', () => {
      it('a bar button’s picker: the first Esc empties the search, the next closes the picker', () => {
        render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: 'People filter' }))
        const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
        fireEvent.change(search, { target: { value: 'bo' } })
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(search.value).toBe('')
        expect(screen.getByPlaceholderText('Search...')).toBe(search)
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
      })

      it('folded: the first Esc empties the search, the next closes the picker', () => {
        render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} fold />)
        fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
        fireEvent.click(screen.getByRole('button', { name: 'Tags filter' }))
        const search = screen.getByPlaceholderText('Search...') as HTMLInputElement
        fireEvent.change(search, { target: { value: 'ur' } })
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(search.value).toBe('')
        expect(screen.getByPlaceholderText('Search...')).toBe(search)
        fireEvent.keyDown(search, { key: 'Escape' })
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
      })
    })

    describe('People picker: Email check-in', () => {
      beforeEach(() => {
        useUIStore.setState({ checkinDialog: null })
        usePersonStore.setState({
          people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' }), makePerson({ id: 3, name: 'Cara' })],
        })
      })

      const openPeople = (personIds: number[] | null) => {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds }} onChange={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: /^People filter/ }))
      }

      // No tasks loaded here: a one-click send has nothing to send, so it opens the dialog for the person with the reason.
      it('narrowed to one person: Email check-in to <name> sends at once (else the dialog, with the reason) and closes the picker', () => {
        openPeople([2])
        fireEvent.click(screen.getByRole('button', { name: 'Email check-in to Bob' }))
        expect(useUIStore.getState().checkinDialog).toEqual({
          personIds: [2],
          notice: 'Bob has no open tasks, so nothing was sent.',
        })
        expect(screen.queryByPlaceholderText('Search...')).toBeNull()
      })

      it('narrowed to several: Email check-in to N people…, ticking exactly those (None ignored)', () => {
        openPeople([3, 0, 1])
        fireEvent.click(screen.getByRole('button', { name: 'Email check-in to 2 people…' }))
        expect(useUIStore.getState().checkinDialog).toEqual({ personIds: [1, 3] })
      })

      it.each([
        ['no filter', null],
        ['every person', [1, 2, 3]],
        ['only None', [0]],
        ['nobody', []],
      ])('%s: a hint instead of the action', (_label, personIds) => {
        openPeople(personIds)
        expect(screen.getByText('Narrow to some people to email them.')).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /^Email check-in/ })).toBeNull()
      })

      it('folded: the action closes the Filters menu too', () => {
        render(<FilterChipBar predicate={{ ...emptyPredicate(), personIds: [1] }} onChange={() => {}} fold />)
        fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
        fireEvent.click(screen.getByRole('button', { name: 'People filter: Alice' }))
        fireEvent.click(screen.getByRole('button', { name: 'Email check-in to Alice' }))
        expect(useUIStore.getState().checkinDialog).toMatchObject({ personIds: [1] })
        expect(screen.queryByRole('group', { name: 'Screen filters' })).toBeNull()
      })

      it('Tags and Status pickers have no such footer', () => {
        render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
        fireEvent.click(screen.getByRole('button', { name: 'Tags filter' }))
        expect(screen.queryByText('Narrow to some people to email them.')).toBeNull()
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
      fireEvent.click(screen.getByText('#urgent'))
      expect(captured).not.toBeNull()
      expect(captured!.tags).not.toContain(10)
    })

    it('the Dates section shows the Dates value (Any when off) and holds the date panel at touch sizes', () => {
      const updates: TodoPredicate[] = []
      const created = { match: 'range' as const, start: { kind: 'relative' as const, token: 'start-of-month' as const }, end: null }
      const { rerender } = render(
        <FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />,
      )
      expect(screen.getByText('Dates').parentElement).toHaveTextContent('Any')
      fireEvent.click(screen.getByText('Dates'))
      fireEvent.click(screen.getByRole('tab', { name: 'Follow-up' }))
      expect(updates).toEqual([])
      fireEvent.click(screen.getByRole('radio', { name: 'No date' }))
      expect(updates.at(-1)?.dates).toEqual({ followup: { match: 'unset' } })
      rerender(<FilterChipBar density="mobile" predicate={{ ...emptyPredicate(), dates: { deadline: { match: 'set' }, created } }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByText('Due + Created')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Clear all dates' }))
      expect(updates.at(-1)?.dates).toEqual({})
    })

    it('sets markers to Yes / No at mobile density', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByText('Priority'))
      fireEvent.click(markerChoice('Focus', 'Yes'))
      expect(updates.at(-1)?.markers).toEqual({ focus: true })
      rerender(<FilterChipBar density="mobile" predicate={updates.at(-1)!} onChange={(p) => updates.push(p)} />)
      expect(markerChoice('Focus', 'Yes')).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(markerChoice('Urgent', 'No'))
      expect(updates.at(-1)?.markers).toEqual({ focus: true, urgent: false })
      rerender(<FilterChipBar density="mobile" predicate={updates.at(-1)!} onChange={(p) => updates.push(p)} />)
      // With a No, the section spells the filter out instead of a count.
      expect(screen.getByText('Focus, not Urgent')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('switch', { name: 'Only hot tasks' }))
      expect(updates.at(-1)?.markers).toBe('hot')
      rerender(<FilterChipBar density="mobile" predicate={updates.at(-1)!} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('switch', { name: 'Only hot tasks' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('radiogroup', { name: 'Urgent' })).toHaveAttribute('aria-disabled', 'true')
      expect(markerChoice('Urgent', 'Any')).toHaveAttribute('aria-checked', 'true')
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
