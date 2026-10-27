import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, act, within } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { POPOVER_CARET_ATTR, PopoverRoot } from '../../../components/shared/PopoverRoot'
import { POPOVER_LEVEL_ATTR } from '../../../components/shared/popover-level'
import { MenuPopover } from '../../../components/shared/MenuPopover'
import { Dialog } from '../../../components/shared/Dialog'
import { FilterChipBar } from '../../../components/shared/filters/FilterChipBar'
import { EditListHost } from '../../../components/workspace/list/EditList'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { emptyPredicate } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { makePerson } from '../../helpers'

/** The popover level an element's root carries. */
const level = (el: Element) => el.getAttribute(POPOVER_LEVEL_ATTR)

afterEach(() => cleanup())

describe('popover levels (D21)', () => {
  it('a popover over the page is level 1; one opened from it — portaled too — is level 2, and deeper ones stay 2', () => {
    render(
      <PopoverRoot data-testid="one">
        {createPortal(
          <PopoverRoot data-testid="two">
            <PopoverRoot data-testid="three" />
          </PopoverRoot>,
          document.body,
        )}
      </PopoverRoot>,
    )
    expect(level(screen.getByTestId('one'))).toBe('1')
    expect(level(screen.getByTestId('two'))).toBe('2')
    expect(level(screen.getByTestId('three'))).toBe('2')
  })

  it('a menu over the page is level 1, its submenu level 2', () => {
    render(<MenuPopover point={{ x: 0, y: 0 }} label="Menu" onClose={() => {}} entries={[
      { kind: 'item', label: 'More', children: [{ kind: 'item', label: 'Inner', onSelect: () => {} }] },
    ]} />)
    expect(level(screen.getByRole('menu', { name: 'Menu' }))).toBe('1')
    fireEvent.click(screen.getByRole('menuitem', { name: 'More' }))
    expect(level(screen.getByRole('menu', { name: 'More' }))).toBe('2')
  })

  it('a menu in a dialog is level 2', () => {
    render(
      <Dialog open onClose={() => {}} title="Settings">
        <MenuPopover point={{ x: 0, y: 0 }} label="Menu" onClose={() => {}} entries={[{ kind: 'item', label: 'Pick', onSelect: () => {} }]} />
      </Dialog>,
    )
    expect(level(screen.getByRole('menu', { name: 'Menu' }))).toBe('2')
  })

  it('a top-bar picker is level 1', () => {
    usePersonStore.setState({ people: [makePerson({ id: 1, name: 'Alice' })], assignedPeopleMap: new Map() })
    render(<FilterChipBar predicate={emptyPredicate()} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'People filter' }))
    const panel = screen.getByPlaceholderText('Search...').closest(`[${POPOVER_LEVEL_ATTR}]`)
    expect(panel).not.toBeNull()
    expect(level(panel!)).toBe('1')
  })

  describe('Edit list', () => {
    const saved: PersistedListDefinition = {
      id: 7, name: 'Waiting on', sortOrder: 0,
      membership: { kind: 'custom', predicate: emptyPredicate() },
      sort: 'deadline', grouping: 'people',
    }
    const layout: PersistedWorkspaceLayout = {
      id: 1, sortOrder: 0, name: 'Default', createdAt: new Date(), modifiedAt: new Date(),
      columns: [{ id: 'col', weight: 1, cells: [{ id: 'c1', weight: 1, tabs: [{ id: 't1', kind: 'lens', config: { listDefinitionId: 7 } }] }] }],
    }

    beforeEach(() => {
      useWorkspaceStore.setState({ working: layout, layouts: [layout] })
      useListDefinitionStore.setState({ listDefinitions: [saved] })
      useListDraftStore.setState({ drafts: {} })
      usePersonStore.setState({ people: [makePerson({ id: 1, name: 'Alice' })], assignedPeopleMap: new Map() })
    })

    it('over the workspace it is level 1; + Filter’s menu and the picker it opens are level 2', () => {
      render(
        <>
          <section data-ws-cell="c1">
            <div data-ws-cell-header="c1"><button type="button" data-ws-tab="t1">Waiting on</button></div>
            <div data-list-host="t1" />
          </section>
          <EditListHost />
        </>,
      )
      act(() => useUIStore.getState().openListEditor(7, 't1'))
      const editList = screen.getByRole('dialog', { name: 'Edit list Waiting on' })
      expect(level(editList)).toBe('1')

      fireEvent.click(within(editList).getByRole('button', { name: /^(Filter|Another filter \(AND\))$/ }))
      expect(level(screen.getByRole('menu', { name: 'Add a filter' }))).toBe('2')
      fireEvent.click(screen.getByRole('menuitem', { name: 'People' }))
      expect(level(screen.getByTestId('list-filter-picker'))).toBe('2')
    })
  })
})

describe('PopoverRoot caret (D21)', () => {
  it('draws the caret as its last child at the hook’s edge point, its side marked; none without one', () => {
    const { rerender } = render(
      <PopoverRoot data-testid="pop" caret={{ side: 'bottom', offset: 20, x: 120, y: 300 }}><button type="button">Item</button></PopoverRoot>,
    )
    const caret = screen.getByTestId('pop').lastElementChild as HTMLElement
    expect(caret.getAttribute(POPOVER_CARET_ATTR)).toBe('bottom')
    expect(caret.getAttribute('aria-hidden')).toBe('true')
    expect(caret.style.left).toBe('120px')
    expect(caret.style.top).toBe('300px')
    rerender(<PopoverRoot data-testid="pop" caret={null}><button type="button">Item</button></PopoverRoot>)
    expect(screen.getByTestId('pop').querySelector(`[${POPOVER_CARET_ATTR}]`)).toBeNull()
  })
})
