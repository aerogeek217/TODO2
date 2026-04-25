import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ListFilterEditor } from '../../../components/settings/ListFilterEditor'
import { useStatusStore } from '../../../stores/status-store'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useProjectStore } from '../../../stores/project-store'
import { useTagStore } from '../../../stores/tag-store'
import type { TodoPredicate } from '../../../models'

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

const noop = () => {}

const wideRect = (): DOMRect =>
  ({
    x: 0, y: 0,
    top: 0, left: 0, right: 9999, bottom: 0,
    width: 9999, height: 0,
    toJSON: () => ({}),
  }) as DOMRect

describe('ListFilterEditor — chip-row picker flip', () => {
  beforeEach(() => {
    usePersonStore.setState({ people: [], assignedPeopleMap: new Map() } as never)
    useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() } as never)
    useProjectStore.setState({ projects: [{ id: 1, canvasId: 1, name: 'Marketing', positionX: 0, positionY: 0, isCollapsed: false, sortOrder: 1, createdAt: new Date() }], loading: false, error: null } as never)
    useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null } as never)
    useStatusStore.setState({
      statuses: [{ id: 1, name: 'Active', color: '#888', sortOrder: 1, icon: 'circle' }],
      loading: false,
      error: null,
    } as never)
  })

  afterEach(cleanup)

  it('flips the Status panel to data-align="end" when it would overflow the viewport right edge', () => {
    const orig = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = wideRect
    try {
      const { getByRole, container } = render(
        <ListFilterEditor predicate={emptyPredicate()} onChange={noop} />,
      )
      fireEvent.click(getByRole('button', { name: /Status/i }))
      expect(container.querySelector('[data-align="end"]')).not.toBeNull()
    } finally {
      Element.prototype.getBoundingClientRect = orig
    }
  })

  it('flips the Project panel under the same overflow condition', () => {
    const orig = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = wideRect
    try {
      const { getByRole, container } = render(
        <ListFilterEditor predicate={emptyPredicate()} onChange={noop} />,
      )
      fireEvent.click(getByRole('button', { name: /Project/i }))
      expect(container.querySelector('[data-align="end"]')).not.toBeNull()
    } finally {
      Element.prototype.getBoundingClientRect = orig
    }
  })

  it('keeps the Status panel left-anchored when there is room (default JSDOM rect)', () => {
    const { getByRole, container } = render(
      <ListFilterEditor predicate={emptyPredicate()} onChange={noop} />,
    )
    fireEvent.click(getByRole('button', { name: /Status/i }))
    // The panel rendered, but no flip — its data-align attribute is absent.
    expect(container.querySelector('[class*="dropdownPanel"]')).not.toBeNull()
    expect(container.querySelector('[data-align="end"]')).toBeNull()
  })

  it('flips the DateRangeDropdown under the same overflow condition', () => {
    const orig = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = wideRect
    try {
      const { getByRole, container } = render(
        <ListFilterEditor predicate={emptyPredicate()} onChange={noop} />,
      )
      fireEvent.click(getByRole('button', { name: /Date/i }))
      expect(container.querySelector('[data-align="end"]')).not.toBeNull()
    } finally {
      Element.prototype.getBoundingClientRect = orig
    }
  })
})
