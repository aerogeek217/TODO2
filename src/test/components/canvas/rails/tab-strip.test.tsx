import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { TabStrip } from '../../../../components/canvas/rails/TabStrip'
import type { Slot } from '../../../../models/canvas-rails'
import { useListDefinitionStore } from '../../../../stores/list-definition-store'

afterEach(() => {
  cleanup()
  useListDefinitionStore.setState({ listDefinitions: [], loading: false, error: null })
})

function makeSlot(): Slot {
  return {
    id: 'slot-a',
    activeTabId: 'slot-a-t0',
    tabs: [
      { id: 'slot-a-t0', type: 'lens', listDefinitionId: 11 },
      { id: 'slot-a-t1', type: 'notes' },
    ],
  }
}

describe('TabStrip', () => {
  it('renders a tab per Slot.tabs and marks the active one', () => {
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 11,
        name: 'Weekly',
        membership: { kind: 'custom', predicate: {} },
        sort: null,
        grouping: null,
        pinnedToDashboard: false,
        order: 0,
      } as unknown as ReturnType<typeof useListDefinitionStore.getState>['listDefinitions'][number]],
      loading: false,
      error: null,
    })
    render(
      <TabStrip
        slot={makeSlot()}
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
      />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')
    // Lens tab uses the list name.
    expect(screen.getByText('Weekly')).toBeInTheDocument()
    // Notes tab uses the generic label.
    expect(screen.getByText('Notes')).toBeInTheDocument()
  })

  it('falls back to "List" when the lens tab has no listDefinitionId', () => {
    const slot: Slot = {
      id: 's',
      activeTabId: 's-t0',
      tabs: [
        { id: 's-t0', type: 'lens' },
        { id: 's-t1', type: 'calendar' },
      ],
    }
    render(
      <TabStrip
        slot={slot}
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
      />,
    )
    expect(screen.getByText('List')).toBeInTheDocument()
    expect(screen.getByText('Calendar')).toBeInTheDocument()
  })

  it('fires onActivateTab on pill click', () => {
    const onActivate = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        onActivateTab={onActivate}
        onCloseTab={() => {}}
        onAddTab={() => {}}
      />,
    )
    // Click the inactive tab's label button.
    const inactive = screen.getAllByRole('tab')[1]
    const button = inactive.querySelector('button')!
    fireEvent.click(button)
    expect(onActivate).toHaveBeenCalledWith('slot-a-t1')
  })

  it('fires onCloseTab on ✕ click', () => {
    const onClose = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        onActivateTab={() => {}}
        onCloseTab={onClose}
        onAddTab={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText('Close Notes'))
    expect(onClose).toHaveBeenCalledWith('slot-a-t1')
  })

  it('opens the add-tab popover and fires onAddTab with the chosen kind', () => {
    const onAdd = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={onAdd}
      />,
    )
    fireEvent.click(screen.getByLabelText('Add tab'))
    // WidgetKindMenu renders via portal; heading is "Add tab".
    const menu = screen.getByRole('menu', { name: 'Add tab' })
    expect(menu).toBeInTheDocument()
    const calendarItem = screen.getByRole('menuitem', { name: /calendar/i })
    fireEvent.click(calendarItem)
    expect(onAdd).toHaveBeenCalledWith('calendar')
  })
})
