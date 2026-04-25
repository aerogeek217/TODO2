import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { FilterChipBar } from '../../../../components/shared/filters/FilterChipBar'
import { useStatusStore } from '../../../../stores/status-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useOrgStore } from '../../../../stores/org-store'
import { useProjectStore } from '../../../../stores/project-store'
import { useTagStore } from '../../../../stores/tag-store'
import type { TodoPredicate } from '../../../../models'
import { makePerson, makeOrg, makeProject } from '../../../helpers'

const emptyPredicate = (): TodoPredicate => ({
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  orgIds: null,
  orgFilterMode: 'include-people',
  projectIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasScheduled: null,
  hasDeadline: null,
  tags: null,
})

const wideRect = (): DOMRect =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 9999,
    bottom: 0,
    width: 9999,
    height: 0,
    toJSON: () => ({}),
  }) as DOMRect

function seedStores() {
  usePersonStore.setState({
    people: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
    assignedPeopleMap: new Map(),
  } as never)
  useOrgStore.setState({
    orgs: [makeOrg({ id: 1, name: 'Acme' })],
    assignedOrgsMap: new Map(),
    personOrgMap: new Map(),
  } as never)
  useProjectStore.setState({
    projects: [
      makeProject({ id: 1, canvasId: 1, name: 'Marketing' }),
      makeProject({ id: 2, canvasId: 1, name: 'Engineering' }),
    ],
    loading: false,
    error: null,
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
    it('opens the Project chip and commits only the clicked project (preview-empty)', () => {
      let captured: TodoPredicate | null = null
      render(
        <FilterChipBar
          predicate={emptyPredicate()}
          onChange={(p) => { captured = p }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Project/i }))
      // Desktop chip enters "preview-empty" mode on open (all-selected hidden,
      // first click commits only the clicked entity). Matches the legacy
      // TopBar / ListFilterEditor semantics.
      fireEvent.click(screen.getByText('Marketing'))
      expect(captured).not.toBeNull()
      expect(captured!.projectIds).toEqual([1])
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
      // First click on Date opens the dropdown AND seeds today's anchor as the
      // start, so updates[0] reflects that. Click 'Has scheduled' next.
      fireEvent.click(screen.getByText('Has scheduled'))
      const last = updates[updates.length - 1]!
      expect(last.hasScheduled).toBe(true)
    })

    it('opens the Date dropdown and exposes the dateField selector', () => {
      render(
        <FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Date/i }))
      expect(screen.getByText('Effective Date')).toBeInTheDocument()
      expect(screen.getByText('Scheduled')).toBeInTheDocument()
    })

    it('flips the Project panel to data-align="end" when right-edge would overflow', () => {
      const orig = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = wideRect
      try {
        const { container } = render(
          <FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />,
        )
        fireEvent.click(screen.getByRole('button', { name: /Project/i }))
        expect(container.querySelector('[data-align="end"]')).not.toBeNull()
      } finally {
        Element.prototype.getBoundingClientRect = orig
      }
    })

    it('keeps panel left-anchored when right-edge has room (default JSDOM rect)', () => {
      const { container } = render(
        <FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />,
      )
      fireEvent.click(screen.getByRole('button', { name: /Project/i }))
      expect(container.querySelector('[data-align="end"]')).toBeNull()
    })

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
    it('expands the Projects accordion and toggles an entity', () => {
      let captured: TodoPredicate | null = null
      render(
        <FilterChipBar
          density="mobile"
          predicate={emptyPredicate()}
          onChange={(p) => { captured = p }}
        />,
      )
      fireEvent.click(screen.getByText('Projects'))
      fireEvent.click(screen.getByText('Marketing'))
      expect(captured).not.toBeNull()
      expect(captured!.projectIds).not.toContain(1)
    })

    it('cycles tri-state Has scheduled at mobile density (button form)', () => {
      const updates: TodoPredicate[] = []
      render(
        <FilterChipBar
          density="mobile"
          predicate={emptyPredicate()}
          onChange={(p) => updates.push(p)}
        />,
      )
      fireEvent.click(screen.getByText('Date range'))
      const btn = screen.getByRole('button', { name: /Has scheduled/ })
      fireEvent.click(btn)
      expect(updates.at(-1)?.hasScheduled).toBe(true)
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
