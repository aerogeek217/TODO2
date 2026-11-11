import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { WidgetKindMenu } from '../../../components/shared/WidgetKindMenu'

afterEach(cleanup)

const ANCHOR = { x: 10, y: 20 }

/** A menu panel's entries as words: an item's label, `—` a separator, `[text]` a group label. */
function panelWords(menu: HTMLElement): string[] {
  return Array.from(menu.children).map((el) => {
    const role = el.getAttribute('role')
    if (role === 'separator') return '—'
    if (role === 'presentation') return `[${el.textContent ?? ''}]`
    return el.getAttribute('data-menu-label') ?? el.textContent ?? ''
  })
}

/** Changing a widget: the kinds are in Change widget's submenu. */
const openChangeWidget = () => fireEvent.click(screen.getByRole('menuitem', { name: /^Change widget/ }))
/** The open Change widget submenu (the menu itself is named Change widget too, and comes first). */
const kindsMenu = () => screen.getAllByRole('menu', { name: 'Change widget' }).at(-1)!

describe('WidgetKindMenu', () => {
  it('renders every kind entry in Change widget’s submenu with the current one marked', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onClose={() => {}}
      />,
    )
    // Under the kind's heading, Change widget › names the current kind; no kind in the menu itself.
    expect(panelWords(screen.getByRole('menu', { name: 'Change widget' }))).toEqual(['[Notes]', 'Change widget'])
    expect(screen.getByRole('menuitem', { name: /^Change widget/ })).toHaveTextContent('Notes')
    expect(screen.queryAllByRole('menuitemradio')).toEqual([])
    openChangeWidget()
    // The kinds are radio items by group under its caption (Tasks: List, Calendar, Eisenhower, Review, Notes; Insights the rest); the current one is checked.
    expect(panelWords(kindsMenu())).toEqual([
      '[Tasks]', 'List', 'Calendar', 'Eisenhower', 'Review', 'Notes',
      '—', '[Insights]',
      'Number', 'Breakdown', 'Pivot', 'Created vs completed', 'Project pulse', 'Neglect map',
    ])
    expect(screen.getAllByRole('menuitemradio').map((el) => el.textContent?.trim())).toEqual([
      'List', 'Calendar', 'Eisenhower', 'Review', 'Notes', 'Number', 'Breakdown', 'Pivot', 'Created vs completed', 'Project pulse', 'Neglect map',
    ])
    expect(screen.getByRole('menuitemradio', { name: /^List/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: /^Notes/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('menuitemradio', { name: /Taskboard/ })).toBeNull()
    for (const gone of [/Dashboard/, /Needs follow-up/, /Next 7 days/, /Stale tasks/, /Recently completed/, /Eisenhower summary/, /What changed/, /^Today/]) {
      expect(screen.queryByRole('menuitemradio', { name: gone })).toBeNull()
    }
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
    openChangeWidget()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^List/ }))
    expect(onChangeKind).toHaveBeenCalledWith('lens')
    expect(onClose).toHaveBeenCalled()
  })

  it('a list tab has no Change list › (UX cleanup 4A, decision 11)', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Change list/ })).toBeNull()
    expect(screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label'))).toEqual(['Change widget'])
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
    // First focused item is Change widget; → opens its kinds on the current one.
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Change widget/ }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^Notes/ }))
    const kinds = kindsMenu()
    // Notes ends Tasks: Down skips the separator and the caption.
    fireEvent.keyDown(kinds, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^Number$/ }))
    fireEvent.keyDown(kinds, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^Notes/ }))
    fireEvent.keyDown(kinds, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^Review/ }))
    fireEvent.keyDown(kinds, { key: 'ArrowUp' })
    fireEvent.keyDown(kinds, { key: 'ArrowUp' })
    fireEvent.keyDown(kinds, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^List/ }))
    // Up from the first wraps to the last: the Neglect map.
    fireEvent.keyDown(kinds, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /Neglect map/ }))
    // Type-ahead: the next item starting with the key.
    fireEvent.keyDown(kinds, { key: 'n' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /^Notes/ }))
  })

  it('renders an "Edit list" item only when onEditList is provided', () => {
    const { rerender } = render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
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

  describe('Insights', () => {
    const openGlance = () => fireEvent.click(screen.getByRole('menuitem', { name: /Insights/ }))

    it('changing: a group in Change widget’s submenu; adding: a submenu of its own, the task kinds inline', () => {
      const { rerender } = render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      expect(screen.queryByRole('menuitem', { name: /Insights/ })).toBeNull()
      expect(screen.queryByRole('menuitemradio', { name: /^Number/ })).toBeNull()
      openChangeWidget()
      expect(screen.getByRole('menuitemradio', { name: /^Number/ })).toHaveAttribute('aria-checked', 'false')
      rerender(
        <WidgetKindMenu
          anchor={ANCHOR}
          onChangeKind={() => {}}
          onClose={() => {}}
          heading="Add widget"
        />,
      )
      // Adding: the groups' headings (the menu is named Add widget); plain items, nothing checked.
      expect(screen.getByRole('menu', { name: 'Add widget' })).toBeInTheDocument()
      expect(screen.getByText('Tasks')).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /^List/ })).not.toHaveAttribute('aria-checked')
      openGlance()
      expect(screen.getByRole('menuitem', { name: 'Number' })).not.toHaveAttribute('aria-checked')
    })

    it('Change widget names the current kind when it is one of them, checked in the submenu', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="trend"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      expect(screen.getByRole('menuitem', { name: /^Change widget/ }).textContent).toContain('Created vs completed')
      openChangeWidget()
      expect(screen.getByRole('menuitemradio', { name: /Created vs completed/ })).toHaveAttribute('aria-checked', 'true')
    })

    it('picking one fires onChangeKind and closes the menu', () => {
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
      openChangeWidget()
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Project pulse/ }))
      expect(onChangeKind).toHaveBeenCalledWith('pulse')
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
      openChangeWidget()
      expect(screen.getByRole('menuitemradio', { name: /^Number$/ })).toBeInTheDocument()
      expect(screen.queryByRole('menuitemradio', { name: /Horizons/ })).toBeNull()
      expect(screen.queryByRole('menuitemradio', { name: /Discipline/ })).toBeNull()
      expect(screen.queryByRole('menuitemradio', { name: /Snooze graveyard/ })).toBeNull()
    })
  })

  it('a list tab opens with its own items: Edit list… · actions · Change widget (no List options)', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        onEditList={() => {}}
        widgetActions={[{ label: 'Copy tasks', onSelect: () => {} }]}
        onClose={() => {}}
      />,
    )
    expect(panelWords(screen.getByRole('menu', { name: 'Change widget' })))
      .toEqual(['[List]', 'Edit list…', 'Copy tasks', 'Change widget'])
    expect(screen.queryByRole('menuitem', { name: /List options/ })).toBeNull()
    // Focus starts on Edit list….
    expect(document.activeElement).toHaveAttribute('data-menu-label', 'Edit list…')
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
    // Change widget names it; in its submenu, under Tasks.
    expect(screen.getByRole('menuitem', { name: /^Change widget/ }).textContent).toContain('Eisenhower')
    openChangeWidget()
    expect(screen.getByRole('menuitemradio', { name: /^Eisenhower$/ })).toHaveAttribute('aria-checked', 'true')
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

describe('WidgetKindMenu — an Eisenhower tab', () => {
  const setting = {
    label: 'Due date makes a task urgent',
    value: '3 days',
    heading: 'Due date makes a task urgent',
    options: [{ key: '3', label: '3 days', checked: true, onSelect: () => {} }],
  }

  it('Edit list… (its own list) first, then Customize panes… · the setting · Change widget; no source line', () => {
    const onEditList = vi.fn()
    const onCustomize = vi.fn()
    const onClose = vi.fn()
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="eisenhower"
        onChangeKind={() => {}}
        onEditList={onEditList}
        widgetSetting={setting}
        sourceActions={[{ label: 'Customize panes…', onSelect: onCustomize }]}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('menu', { name: 'Change widget' })).not.toHaveTextContent('Shows')
    expect(screen.getAllByRole('menuitem').map((el) => el.getAttribute('data-menu-label')))
      .toEqual(['Edit list…', 'Customize panes…', 'Due date makes a task urgent', 'Change widget'])
    expect(panelWords(screen.getByRole('menu', { name: 'Change widget' }))[0]).toBe('[Eisenhower]')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit list…' }))
    expect(onEditList).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('WidgetKindMenu on a tab with setting entries (a Neglect map)', () => {
  it('lists the entries first, their submenus as given, then Change widget', () => {
    const onPick = vi.fn()
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="neglect"
        onChangeKind={() => {}}
        settingEntries={[
          { kind: 'item', label: 'Colour by', note: 'People', children: [{ kind: 'item', label: 'None', radio: true, onSelect: onPick }] },
          { kind: 'item', label: 'Untouched after', note: '14 days', children: [] },
        ]}
        onClose={() => {}}
      />,
    )
    expect(panelWords(screen.getByRole('menu', { name: 'Change widget' }))).toEqual(['[Neglect map]', 'Colour by', 'Untouched after', 'Change widget'])
    expect(screen.getByRole('menuitem', { name: /^Change widget/ }).textContent).toContain('Neglect map')
    fireEvent.click(screen.getByRole('menuitem', { name: /Colour by/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'None' }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
