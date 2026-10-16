import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react'
import { WidgetKindMenu } from '../../../components/shared/WidgetKindMenu'
import { useUIStore } from '../../../stores/ui-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import type { PersistedListDefinition } from '../../../models'

afterEach(cleanup)

const ANCHOR = { x: 10, y: 20 }

describe('WidgetKindMenu', () => {
  it('renders every kind entry with the current one marked', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onClose={() => {}}
      />,
    )
    // The kinds are radio items under "Change widget"; the current one is checked.
    expect(screen.getByText('Change widget')).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /List/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /Notes/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('menuitemradio', { name: /Taskboard/ })).toBeNull()
    // The Status widget is retired (its bar lives on in the Dashboard).
    expect(screen.queryByRole('menuitemradio', { name: /status/i })).toBeNull()
    // List · Calendar · Notes · Eisenhower · Dashboard.
    expect(screen.getAllByRole('menuitemradio').map((el) => el.textContent?.trim()))
      .toEqual(['List', 'Calendar', 'Notes', 'Eisenhower', 'Dashboard'])
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
  })

  it('fires onChangeKind with the selected kind and closes', () => {
    const onChangeKind = vi.fn()
    const onClose = vi.fn()
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={onChangeKind}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Calendar/ }))
    expect(onChangeKind).toHaveBeenCalledWith('calendar')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a secondary "Change list…" row only when current kind is lens and pickListForLens is provided', () => {
    const { rerender } = render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        pickListForLens={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Change list/ })).toBeNull()

    rerender(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        pickListForLens={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: /Change list/ })).toBeInTheDocument()
  })

  it('does NOT show a secondary row for a kind with nothing to pick', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="dashboard"
        onChangeKind={() => {}}
        pickListForLens={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Change/ })).toBeNull()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('ArrowDown / ArrowUp cycle through kind items', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onClose={() => {}}
      />,
    )
    // First focused item is List.
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /List/ }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Calendar/ }))
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Dashboard/ }))
    // Type-ahead: the next item starting with the key.
    fireEvent.keyDown(menu, { key: 'n' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Notes/ }))
  })

  it('renders an "Edit list" item only when current kind is lens and onEditList is provided', () => {
    const { rerender } = render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onEditList={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Edit list/ })).toBeNull()

    rerender(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Edit list/ })).toBeNull()

    rerender(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        onEditList={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: /Edit list/ })).toBeInTheDocument()
  })

  it('clicking "Edit list" fires onEditList with the bound def id and closes the menu', () => {
    const onEditList = vi.fn()
    const onClose = vi.fn()
    const DEF_ID = 7
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        onEditList={() => onEditList(DEF_ID)}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit list/ }))
    expect(onEditList).toHaveBeenCalledWith(DEF_ID)
    expect(onClose).toHaveBeenCalled()
  })

  describe('Dashboard', () => {
    it('is a top-level kind in both change and add mode (no Stats submenu)', () => {
      const { rerender } = render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      expect(screen.getByRole('menuitemradio', { name: /Dashboard/ })).toBeInTheDocument()
      expect(screen.queryByRole('menuitemradio', { name: /^Stats/ })).toBeNull()
      rerender(
        <WidgetKindMenu
          anchor={ANCHOR}
          onChangeKind={() => {}}
          onClose={() => {}}
          heading="Add widget"
        />,
      )
      // Adding: plain items, nothing checked.
      expect(screen.getByRole('menuitem', { name: /Dashboard/ })).not.toHaveAttribute('aria-checked')
      expect(screen.getByText('Add widget')).toBeInTheDocument()
    })

    it('is marked active when the current kind is dashboard', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="dashboard"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      expect(screen.getByRole('menuitemradio', { name: /Dashboard/ })).toHaveAttribute('aria-checked', 'true')
    })

    it('picking it fires onChangeKind("dashboard") and closes the menu', () => {
      const onChangeKind = vi.fn()
      const onClose = vi.fn()
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={onChangeKind}
          onClose={onClose}
        />,
      )
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Dashboard/ }))
      expect(onChangeKind).toHaveBeenCalledWith('dashboard')
      expect(onClose).toHaveBeenCalled()
    })

    it('offers none of the removed date-based widgets', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      expect(screen.queryByRole('menuitemradio', { name: /Horizons/ })).toBeNull()
      expect(screen.queryByRole('menuitemradio', { name: /Discipline/ })).toBeNull()
      expect(screen.queryByRole('menuitemradio', { name: /Snooze graveyard/ })).toBeNull()
    })
  })

  describe('Edit list opens the direct dialog', () => {
    beforeEach(() => {
      useUIStore.setState({
        listEditorDialogId: null,
        listsEditorOpen: false,
        listsEditorInitialId: null,
      })
    })

    it('clicking Edit list when bound to openListEditorDialog opens only the dialog (no Lists manager)', () => {
      const DEF_ID = 42
      // Mirrors the list tab call-site binding: the "Edit list" entry calls
      // `openListEditorDialog`, not `openListsEditor` (manager modal).
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="lens"
          onChangeKind={() => {}}
          onEditList={() => useUIStore.getState().openListEditorDialog(DEF_ID)}
          onClose={() => {}}
        />,
      )
      fireEvent.click(screen.getByRole('menuitem', { name: /Edit list/ }))
      expect(useUIStore.getState().listEditorDialogId).toBe(DEF_ID)
      // Lists manager modal must NOT open — that's the deliberate split.
      expect(useUIStore.getState().listsEditorOpen).toBe(false)
      expect(useUIStore.getState().listsEditorInitialId).toBeNull()
    })
  })
})

describe('WidgetKindMenu — widget setting submenu', () => {
  const onSelect = vi.fn()
  const setting = {
    label: 'Due date makes a task urgent',
    value: '3 days',
    heading: 'Due date makes a task urgent',
    options: [
      { key: 'off', label: 'Off', note: 'only the flag counts', checked: false, onSelect },
      { key: '3', label: '3 days', note: 'by Tue 13', checked: true, onSelect: () => {} },
    ],
    footnote: 'Overdue tasks count too.',
  }

  beforeEach(() => onSelect.mockClear())

  it('lists the setting first with its value; Eisenhower is a kind', () => {
    render(<WidgetKindMenu anchor={ANCHOR} currentKind="eisenhower" onChangeKind={() => {}} onClose={() => {}} widgetSetting={setting} />)
    const items = screen.getAllByRole('menuitem')
    expect(items[0]).toHaveTextContent('Due date makes a task urgent3 days')
    expect(screen.getByRole('menuitemradio', { name: /Eisenhower/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('→ opens the submenu on the checked choice; picking one runs it and closes the menu', () => {
    const onClose = vi.fn()
    render(<WidgetKindMenu anchor={ANCHOR} currentKind="eisenhower" onChangeKind={() => {}} onClose={onClose} widgetSetting={setting} />)
    const row = screen.getAllByRole('menuitem')[0]!
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const sub = screen.getByRole('menu', { name: 'Due date makes a task urgent' })
    expect(sub).toHaveTextContent('Overdue tasks count too.')
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /3 days/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Off/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Off/ }))
    expect(onSelect).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Esc in the submenu closes only the submenu', () => {
    const onClose = vi.fn()
    render(<WidgetKindMenu anchor={ANCHOR} currentKind="eisenhower" onChangeKind={() => {}} onClose={onClose} widgetSetting={setting} />)
    fireEvent.click(screen.getAllByRole('menuitem')[0]!)
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: /3 days/ }), { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Due date makes a task urgent' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('WidgetKindMenu — an action that opens a panel', () => {
  const panelAction = (onPanelButton = vi.fn()) => ({
    label: 'Hot is',
    note: 'U+I or Focus',
    panel: {
      label: 'Hot rule',
      width: 316,
      render: () => (
        <div>
          <button type="button" onClick={onPanelButton}>Urgent</button>
          <button type="button">Important</button>
        </div>
      ),
    },
  })

  it('lists the action with its note; a click opens the panel beside it with the focus inside', async () => {
    const onClose = vi.fn()
    const onPanelButton = vi.fn()
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="dashboard"
        onChangeKind={() => {}}
        onClose={onClose}
        widgetActions={[{ label: 'Customize dashboard…', onSelect: () => {} }, panelAction(onPanelButton)]}
      />,
    )
    const row = screen.getByRole('menuitem', { name: /Hot is/ })
    expect(row).toHaveTextContent('U+I or Focus')
    expect(row).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(row)
    const panel = screen.getByRole('dialog', { name: 'Hot rule' })
    expect(panel.style.width).toBe('316px')
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Urgent' })))
    // Its controls work without closing anything.
    fireEvent.click(screen.getByRole('button', { name: 'Urgent' }))
    expect(onPanelButton).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // Menu keys stay in the panel: ↓ doesn't move to a menu item.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(screen.getByRole('dialog', { name: 'Hot rule' })).toBeTruthy()
  })

  it('Esc or ← in the panel closes only the panel, back on its item', async () => {
    const onClose = vi.fn()
    render(<WidgetKindMenu anchor={ANCHOR} currentKind="dashboard" onChangeKind={() => {}} onClose={onClose} widgetActions={[panelAction()]} />)
    const row = screen.getByRole('menuitem', { name: /Hot is/ })
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Urgent' })))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Hot rule' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(row))

    fireEvent.click(row)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Urgent' })))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(screen.queryByRole('dialog', { name: 'Hot rule' })).toBeNull()
    // Then Esc closes the menu.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('the menu and its panel keep app shortcuts out', () => {
    render(<WidgetKindMenu anchor={ANCHOR} currentKind="dashboard" onChangeKind={() => {}} onClose={() => {}} widgetActions={[panelAction()]} />)
    expect(screen.getByRole('menu')).toHaveAttribute('data-shortcut-scope', 'none')
    fireEvent.click(screen.getByRole('menuitem', { name: /Hot is/ }))
    expect(screen.getByRole('dialog', { name: 'Hot rule' })).toHaveAttribute('data-shortcut-scope', 'none')
  })
})

describe('WidgetKindMenu — Change list submenu', () => {
  beforeEach(() => {
    useListDefinitionStore.setState({
      listDefinitions: [
        { id: 2, name: 'Second', sortOrder: 1 } as PersistedListDefinition,
        { id: 1, name: 'First', sortOrder: 0 } as PersistedListDefinition,
      ],
    })
  })

  it('→ opens the saved lists in their order with the focus on the first; a pick runs and closes the menu', () => {
    const pick = vi.fn()
    const onClose = vi.fn()
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        pickListForLens={pick}
        onListOptions={() => {}}
        currentListName="First"
        onClose={onClose}
      />,
    )
    const row = screen.getByRole('menuitem', { name: /Change list/ })
    expect(row).toHaveTextContent('First')
    expect(row).toHaveAttribute('aria-haspopup', 'menu')
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const sub = screen.getByRole('menu', { name: 'Change list' })
    expect(Array.from(sub.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)).toEqual(['First', 'Second'])
    expect(document.activeElement).toHaveTextContent('First')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Second' }))
    expect(pick).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when there are no lists', () => {
    useListDefinitionStore.setState({ listDefinitions: [] })
    render(<WidgetKindMenu anchor={ANCHOR} currentKind="lens" onChangeKind={() => {}} pickListForLens={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Change list/ }))
    expect(screen.getByRole('menu', { name: 'Change list…' })).toHaveTextContent('No lists yet.')
  })
})
