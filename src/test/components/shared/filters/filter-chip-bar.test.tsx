import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { FilterChipBar } from '../../../../components/shared/filters/FilterChipBar'
import type { TodoPredicate } from '../../../../models'
import { useStatusStore } from '../../../../stores/status-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useTagStore } from '../../../../stores/tag-store'
import { emptyPredicate } from '../../../../stores/list-definition-store'
import { makePerson } from '../../../helpers'

function seedStores() {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    assignedPeopleMap: new Map(),
  } as never)
  useStatusStore.setState({
    statuses: [{ id: 1, name: 'Active', color: '#888', sortOrder: 1, icon: 'circle' }],
    loading: false,
    error: null,
  } as never)
  useTagStore.setState({
    tags: [
      { id: 10, name: 'urgent', color: '#f00' },
      { id: 20, name: 'soon', color: '#0f0' },
    ],
    assignedTagsMap: new Map(),
    loading: false,
    error: null,
  } as never)
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
      render(<FilterChipBar predicate={active} onChange={(p) => updates.push(p)} onClearAll={() => updates.push(emptyPredicate())} fold compact />)
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

    it('the Markers button (after Status) ticks markers that AND; unticking the last clears it', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      const filterNames = screen.getAllByRole('button', { name: / filter$/ }).map((b) => b.getAttribute('aria-label'))
      expect(filterNames.indexOf('Markers filter')).toBe(filterNames.indexOf('Status filter') + 1)
      expect(screen.queryByRole('button', { name: /^Focus filter/ })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Markers filter' }))
      expect(screen.getByText(/strict AND/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Focus' }))
      expect(updates.at(-1)?.markers).toEqual({ focus: true })
      // The picker stays open for a second pick.
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { focus: true } }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('checkbox', { name: 'Focus' })).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }))
      expect(updates.at(-1)?.markers).toEqual({ urgent: true, focus: true })
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { urgent: true, focus: true } }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('button', { name: 'Markers filter: Urgent +1' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }))
      fireEvent.click(screen.getByRole('button', { name: 'Clear markers filter' }))
      expect(updates.at(-1)?.markers).toBeNull()
    })

    it('Hot comes first; ticking it replaces the single markers and greys them out', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={{ ...emptyPredicate(), markers: { urgent: true } }} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: 'Markers filter: Urgent' }))
      const names = screen.getAllByRole('checkbox').map((c) => c.textContent)
      expect(names).toEqual(['Hot', 'Urgent', 'Important', 'Focus'])
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hot' }))
      expect(updates.at(-1)?.markers).toBe('hot')

      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), markers: 'hot' }} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('button', { name: 'Markers filter: Hot' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Hot' })).toHaveAttribute('aria-checked', 'true')
      for (const name of ['Urgent', 'Important', 'Focus']) {
        expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-disabled', 'true')
        expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'false')
      }
      expect(screen.getByText('Hot already combines these markers. Clear Hot to pick them one by one.')).toBeInTheDocument()
      const before = updates.length
      fireEvent.click(screen.getByRole('checkbox', { name: 'Important' }))
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

    it('cycles a tri-state row inside the Date dropdown', () => {
      const updates: TodoPredicate[] = []
      render(
        <FilterChipBar
          predicate={emptyPredicate()}
          onChange={(p) => updates.push(p)}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Date/i }))
      // Opening the Date dropdown is non-committal: no anchor is
      // seeded, so updates is empty until the user actually edits something.
      expect(updates).toHaveLength(0)
      fireEvent.click(screen.getByText('Has due date'))
      const last = updates[updates.length - 1]!
      expect(last.hasDeadline).toBe(true)
    })

    it('opening Date with no active filter does NOT commit a today anchor', () => {
      // Clicking the Date chip without
      // editing inputs must leave the predicate untouched. The earlier UX
      // auto-stamped startOfToday() as the start anchor on open and surprised
      // users by activating a filter from a no-op interaction.
      const updates: TodoPredicate[] = []
      render(
        <FilterChipBar
          predicate={emptyPredicate()}
          onChange={(p) => updates.push(p)}
        />,
      )
      // The chevron-bearing chip button is the only Date trigger that has
      // aria-expanded — the inner field-selector buttons match /Date/i too
      // (e.g. "Due date") once the panel opens.
      const chip = screen.getAllByRole('button', { name: /Date/i }).find(
        (el) => el.getAttribute('aria-expanded') !== null,
      )!
      fireEvent.click(chip)
      // Panel is open (date inputs render), but no onChange has fired.
      expect(screen.getByText('From')).toBeInTheDocument()
      expect(updates).toHaveLength(0)
      // Closing the dropdown also leaves the predicate untouched.
      fireEvent.click(chip)
      expect(updates).toHaveLength(0)
    })

    it('Clear button uses onClearAll override when provided (skips onChange)', () => {
      // Item 13: TopBar/FilterSheet pass `onClearAll` so the topbar Clear path
      // routes through `useFilterStore.clearAll()` (which also drops the
      // runtime-filter slot). The FilterChipBar primitive must skip its
      // default onChange-based clear when the override is supplied.
      let cleared = 0
      let captured: TodoPredicate | null = null
      const active: TodoPredicate = { ...emptyPredicate(), showCompleted: true }
      render(
        <FilterChipBar
          predicate={active}
          onChange={(p) => { captured = p }}
          onClearAll={() => { cleared += 1 }}
        />,
      )
      fireEvent.click(screen.getByTitle('Clear all filters'))
      expect(cleared).toBe(1)
      // onChange was NOT called with DEFAULT_PREDICATE — override takes over.
      expect(captured).toBeNull()
    })

    it('opens the Date dropdown and exposes the dateField selector', () => {
      render(
        <FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Date/i }))
      expect(screen.getByText('Due date')).toBeInTheDocument()
      expect(screen.getByText('Next follow-up')).toBeInTheDocument()
      expect(screen.queryByText('Scheduled')).toBeNull()
      expect(screen.queryByText('Effective Date')).toBeNull()
    })

    it('switching dateField commits BOTH field and seeded anchors atomically', () => {
      // Regression: two in-handler `update` calls (one for `dateField`, one for
      // anchors) used to close over the same stale `p`, so the second call
      // dropped the dateField change. The dropdown's input row visibly changed
      // but the effective filter still ran against the previous field.
      const updates: TodoPredicate[] = []
      render(
        <FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Date/i }))
      fireEvent.click(screen.getByText('Next follow-up'))
      const last = updates.at(-1)!
      expect(last.dateField).toBe('followup')
      expect(last.dateRangeStart).not.toBeNull()
    })

    it('Clear inside Date dropdown clears anchors and both tri-states atomically', () => {
      // Same closure-staleness bug as above: chained `update` calls for
      // anchors + hasDeadline + hasFollowup used to leave the earlier patches
      // re-overwritten by the later ones.
      const updates: TodoPredicate[] = []
      const active: TodoPredicate = {
        ...emptyPredicate(),
        dateRangeStart: { kind: 'fixed', iso: new Date().toISOString() },
        hasFollowup: true,
        hasDeadline: false,
      }
      render(
        <FilterChipBar predicate={active} onChange={(p) => updates.push(p)} />,
      )
      fireEvent.click(screen.getByRole('button', { name: /^Dates filter:/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
      const last = updates.at(-1)!
      expect(last.dateRangeStart).toBeNull()
      expect(last.dateRangeEnd).toBeNull()
      expect(last.hasFollowup).toBeNull()
      expect(last.hasDeadline).toBeNull()
    })

    // Flip / clamp behavior is owned by `usePopoverAnchor` and verified in
    // real-browser e2e (see e2e/list-editor-dropdowns.spec.ts) — JSDOM's
    // synthetic getBoundingClientRect can't drive the hook's measurement
    // pass meaningfully (per ARCHITECTURE.md / Testing).
    it('renders the Clear button only when the predicate has at least one active filter', () => {
      const { rerender } = render(
        <FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />,
      )
      expect(screen.queryByTitle('Clear all filters')).toBeNull()

      const active: TodoPredicate = { ...emptyPredicate(), showCompleted: true }
      rerender(<FilterChipBar predicate={active} onChange={() => {}} />)
      expect(screen.getByTitle('Clear all filters')).toBeInTheDocument()
    })
  })

  // ── Mobile density ───────────────────────────────────────────────────

  describe('mobile density', () => {
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

    it('cycles tri-state Has due date at mobile density (button form)', () => {
      const updates: TodoPredicate[] = []
      render(
        <FilterChipBar
          density="mobile"
          predicate={emptyPredicate()}
          onChange={(p) => updates.push(p)}
        />,
      )
      fireEvent.click(screen.getByText('Date range'))
      const btn = screen.getByRole('button', { name: /Has due date/ })
      fireEvent.click(btn)
      expect(updates.at(-1)?.hasDeadline).toBe(true)
    })

    it('switches markers on at mobile density', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByText('Show / hide'))
      fireEvent.click(screen.getByRole('switch', { name: 'Only focus tasks' }))
      expect(updates.at(-1)?.markers).toEqual({ focus: true })
      rerender(<FilterChipBar density="mobile" predicate={updates.at(-1)!} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('switch', { name: 'Only focus tasks' })).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('switch', { name: 'Only urgent tasks' }))
      expect(updates.at(-1)?.markers).toEqual({ urgent: true, focus: true })
      fireEvent.click(screen.getByRole('switch', { name: 'Only hot tasks' }))
      expect(updates.at(-1)?.markers).toBe('hot')
      rerender(<FilterChipBar density="mobile" predicate={updates.at(-1)!} onChange={(p) => updates.push(p)} />)
      expect(screen.getByRole('switch', { name: 'Only hot tasks' })).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByRole('switch', { name: 'Only urgent tasks' })).toBeDisabled()
      expect(screen.getByRole('switch', { name: 'Only urgent tasks' })).toHaveAttribute('aria-checked', 'false')
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
