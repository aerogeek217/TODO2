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
    const inactive = screen.getAllByRole('tab')[1]!
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
    expect(onAdd).toHaveBeenCalledWith('calendar', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
  })

  it('right-click on a non-active pill fires onOpenChangeType with that pill\'s tabId at click coords', () => {
    // triage-2026-04-27 P1 / Item 4: caret button removed; right-click is now
    // the entry point for the per-tab kind-change menu.
    const onOpenChangeType = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onOpenChangeType={onOpenChangeType}
      />,
    )
    // Active is 'slot-a-t0' (lens/Weekly) — right-click the inactive Notes pill.
    const inactivePill = screen.getAllByRole('tab')[1]!
    fireEvent.contextMenu(inactivePill, { clientX: 123, clientY: 45 })
    expect(onOpenChangeType).toHaveBeenCalledTimes(1)
    const [tabId, anchor] = onOpenChangeType.mock.calls[0]
    expect(tabId).toBe('slot-a-t1')
    expect(anchor).toEqual({ x: 123, y: 45 })
  })

  it('right-click on the active pill fires onOpenChangeType with its tabId + click coords', () => {
    const onOpenChangeType = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onOpenChangeType={onOpenChangeType}
      />,
    )
    const activePill = screen.getAllByRole('tab')[0]!
    fireEvent.contextMenu(activePill, { clientX: 200, clientY: 80 })
    expect(onOpenChangeType).toHaveBeenCalledTimes(1)
    const [tabId, anchor] = onOpenChangeType.mock.calls[0]
    expect(tabId).toBe('slot-a-t0')
    expect(anchor).toEqual({ x: 200, y: 80 })
  })

  it('left-click on a pill still activates it (regression — context menu does not steal click)', () => {
    const onActivate = vi.fn()
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={onActivate}
        onCloseTab={() => {}}
        onAddTab={() => {}}
        onOpenChangeType={() => {}}
      />,
    )
    const inactivePill = screen.getAllByRole('tab')[1]!
    const button = inactivePill.querySelector('button')!
    fireEvent.click(button)
    expect(onActivate).toHaveBeenCalledWith('slot-a-t1')
  })

  it('renders no caret button (caret chrome retired in triage-2026-04-27 P1)', () => {
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
    expect(screen.queryByLabelText(/tab options$/i)).toBeNull()
    expect(screen.queryByText('▾')).toBeNull()
  })

  it('renders title-cased labels for every SlotKind (no Calendar fallthrough on stats kinds)', () => {
    // Item 5: KIND_LABEL extended to Status / Discipline / Snooze graveyard /
    // Horizons / Taskboard / Notes / Calendar / List; tabLabel reads from it.
    const slot: Slot = {
      id: 's',
      activeTabId: 's-t0',
      tabs: [
        { id: 's-t0', type: 'status' },
        { id: 's-t1', type: 'scoreboard' },
        { id: 's-t2', type: 'snoozeGraveyard' },
        { id: 's-t3', type: 'horizons' },
        { id: 's-t4', type: 'taskboard' },
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
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Discipline')).toBeInTheDocument()
    expect(screen.getByText('Snooze graveyard')).toBeInTheDocument()
    expect(screen.getByText('Horizons')).toBeInTheDocument()
    expect(screen.getByText('Taskboard')).toBeInTheDocument()
  })

  it('sets role=tab + id on each pill so aria-labelledby can link a tabpanel', () => {
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
    expect(tabs[0]).toHaveAttribute('id', 'slot-a-t0')
    expect(tabs[1]).toHaveAttribute('id', 'slot-a-t1')
  })

  it('ArrowRight moves focus + activates the next tab', () => {
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
    const activePill = screen.getAllByRole('tab')[0]!
    const activeBtn = activePill.querySelector('button') as HTMLButtonElement
    activeBtn.focus()
    fireEvent.keyDown(activeBtn, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenCalledWith('slot-a-t1')
  })

  it('ArrowLeft wraps to the last tab', () => {
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
    const activePill = screen.getAllByRole('tab')[0]!
    const activeBtn = activePill.querySelector('button') as HTMLButtonElement
    activeBtn.focus()
    fireEvent.keyDown(activeBtn, { key: 'ArrowLeft' })
    expect(onActivate).toHaveBeenCalledWith('slot-a-t1')
  })

  it('Home activates the first tab, End activates the last', () => {
    const onActivate = vi.fn()
    const slot: Slot = {
      id: 's',
      activeTabId: 's-t1',
      tabs: [
        { id: 's-t0', type: 'lens' },
        { id: 's-t1', type: 'notes' },
        { id: 's-t2', type: 'calendar' },
      ],
    }
    render(
      <TabStrip
        slot={slot}
        fromSide="right"
        onActivateTab={onActivate}
        onCloseTab={() => {}}
        onAddTab={() => {}}
      />,
    )
    const middle = screen.getAllByRole('tab')[1]!.querySelector('button') as HTMLButtonElement
    middle.focus()
    fireEvent.keyDown(middle, { key: 'Home' })
    expect(onActivate).toHaveBeenLastCalledWith('s-t0')
    fireEvent.keyDown(middle, { key: 'End' })
    expect(onActivate).toHaveBeenLastCalledWith('s-t2')
  })

  it('Delete on a focused tab fires onCloseTab for that tab', () => {
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
    const secondPill = screen.getAllByRole('tab')[1]!
    const secondBtn = secondPill.querySelector('button') as HTMLButtonElement
    secondBtn.focus()
    fireEvent.keyDown(secondBtn, { key: 'Delete' })
    expect(onClose).toHaveBeenCalledWith('slot-a-t1')
  })

  it('only the active pill button is in tab order (roving tabindex)', () => {
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
    const activeBtn = tabs[0]!.querySelector('button') as HTMLButtonElement
    const inactiveBtn = tabs[1]!.querySelector('button') as HTMLButtonElement
    expect(activeBtn.tabIndex).toBe(0)
    expect(inactiveBtn.tabIndex).toBe(-1)
  })

  it('right-click is a no-op when onOpenChangeType is not provided (browser default not suppressed)', () => {
    render(
      <TabStrip
        slot={makeSlot()}
        fromSide="right"
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onAddTab={() => {}}
      />,
    )
    const pill = screen.getAllByRole('tab')[0]!
    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    pill.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })
})
