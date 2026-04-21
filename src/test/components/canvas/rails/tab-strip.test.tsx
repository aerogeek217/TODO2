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
        fromSide="right"
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
        fromSide="right"
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
        fromSide="right"
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
        fromSide="right"
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
        fromSide="right"
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

  it('shows a ⋯ button on the active pill when pop-out or change-type is wired', () => {
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onPopOut={() => {}}
        onOpenChangeType={() => {}}
      />,
    )
    // Active pill's tab options button exists.
    const moreBtns = screen.queryAllByLabelText(/tab options$/i)
    expect(moreBtns.length).toBe(1)
  })

  it('does not render the ⋯ button on inactive pills', () => {
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onPopOut={() => {}}
        onOpenChangeType={() => {}}
      />,
    )
    // Only one more button total; it belongs to the active (first) pill.
    const moreBtns = screen.getAllByLabelText(/tab options$/i)
    expect(moreBtns.length).toBe(1)
    // The second pill's Notes close button exists but no Notes tab options.
    expect(screen.queryByLabelText(/Notes tab options/i)).toBeNull()
  })

  it('pill ⋯ menu fires onPopOut when "Pop out to canvas" is clicked', () => {
    const onPopOut = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onPopOut={onPopOut}
        onOpenChangeType={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/tab options$/i))
    const menu = screen.getByRole('menu', { name: 'Tab options' })
    expect(menu).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /pop out to canvas/i }))
    expect(onPopOut).toHaveBeenCalled()
  })

  it('pill ⋯ menu fires onOpenChangeType with the anchor when "Change type…" is clicked', () => {
    const onOpenChangeType = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onPopOut={() => {}}
        onOpenChangeType={onOpenChangeType}
      />,
    )
    fireEvent.click(screen.getByLabelText(/tab options$/i))
    fireEvent.click(screen.getByRole('menuitem', { name: /change type/i }))
    expect(onOpenChangeType).toHaveBeenCalledTimes(1)
    const anchor = onOpenChangeType.mock.calls[0][0]
    expect(typeof anchor.x).toBe('number')
    expect(typeof anchor.y).toBe('number')
  })

  it('pill ⋯ menu omits items whose callback is not provided', () => {
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onOpenChangeType={() => {}}
      />,
    )
    fireEvent.click(screen.getByLabelText(/tab options$/i))
    // Only "Change type…" is present since onPopOut was omitted.
    expect(screen.queryByRole('menuitem', { name: /pop out/i })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /change type/i })).toBeInTheDocument()
  })
})
