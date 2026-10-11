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
      render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
      expect(screen.getByRole('switch', { name: /Show completed/i })).toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: /hidden/i })).toBeNull()
    })

    it('the Focus button picks in focus / not in focus / any task', () => {
      const updates: TodoPredicate[] = []
      const { rerender } = render(<FilterChipBar predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: /Focus/ }))
      fireEvent.click(screen.getByRole('radio', { name: 'In focus' }))
      expect(updates.at(-1)?.focus).toBe(true)
      rerender(<FilterChipBar predicate={{ ...emptyPredicate(), focus: true }} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByRole('button', { name: /Focus/ }))
      expect(screen.getByRole('radio', { name: 'In focus' })).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('radio', { name: 'Any task' }))
      expect(updates.at(-1)?.focus).toBeNull()
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
      // Item 11 (triage-2026-04-27 batch 2): clicking the Date chip without
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
      fireEvent.click(screen.getByRole('button', { name: /Date/i }))
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

    it('cycles the In focus tri-state at mobile density', () => {
      const updates: TodoPredicate[] = []
      render(<FilterChipBar density="mobile" predicate={emptyPredicate()} onChange={(p) => updates.push(p)} />)
      fireEvent.click(screen.getByText('Show / hide'))
      fireEvent.click(screen.getByRole('button', { name: /In focus/ }))
      expect(updates.at(-1)?.focus).toBe(true)
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
