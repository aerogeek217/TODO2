import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { WidgetKindMenu } from '../../../components/shared/WidgetKindMenu'
import { useUIStore } from '../../../stores/ui-store'

afterEach(cleanup)

const ANCHOR = { x: 10, y: 20 }

describe('WidgetKindMenu', () => {
  it('renders all four kind entries with the current one marked', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: /List/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Notes/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitem', { name: /Calendar/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Taskboard/ })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('menuitem', { name: /Taskboard/ }))
    expect(onChangeKind).toHaveBeenCalledWith('taskboard')
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

  it('does NOT show a secondary row for taskboard (singleton — nothing to pick)', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="taskboard"
        onChangeKind={() => {}}
        pickListForLens={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Change taskboard/ })).toBeNull()
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
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /List/ }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Notes/ }))
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

  describe('Stats ▸ flyout (stats-widgets-2026-04-25)', () => {
    it('renders a "Stats" row regardless of mode (always visible)', () => {
      const { rerender } = render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      expect(screen.getByRole('menuitem', { name: /^Stats/ })).toBeInTheDocument()
      // Add mode (no currentKind) — Stats row still shown.
      rerender(
        <WidgetKindMenu
          anchor={ANCHOR}
          onChangeKind={() => {}}
          onClose={() => {}}
          heading="Add widget"
        />,
      )
      expect(screen.getByRole('menuitem', { name: /^Stats/ })).toBeInTheDocument()
    })

    it('marks the Stats row active when the current kind is one of the stats kinds', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="snoozeGraveyard"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      const statsRow = screen.getByRole('menuitem', { name: /^Stats/ })
      expect(statsRow.className).toMatch(/active/)
    })

    it('hovering the Stats row reveals horizons / status / scoreboard / snoozeGraveyard items', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      const statsRow = screen.getByRole('menuitem', { name: /^Stats/ })
      fireEvent.pointerEnter(statsRow)
      expect(screen.getByRole('menu', { name: /Stats widgets/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /Horizons/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /Open by status/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /Discipline/ })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /Snooze graveyard/ })).toBeInTheDocument()
    })

    it('ArrowRight on the Stats row opens its flyout', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      const statsRow = screen.getByRole('menuitem', { name: /^Stats/ })
      statsRow.focus()
      fireEvent.keyDown(screen.getByRole('menu', { name: /Change widget/ }), { key: 'ArrowRight' })
      expect(screen.getByRole('menu', { name: /Stats widgets/ })).toBeInTheDocument()
    })

    it('ArrowLeft from inside the flyout closes it and returns focus to the Stats row', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={() => {}}
        />,
      )
      const statsRow = screen.getByRole('menuitem', { name: /^Stats/ })
      fireEvent.pointerEnter(statsRow)
      fireEvent.keyDown(screen.getByRole('menu', { name: /Change widget/ }), { key: 'ArrowLeft' })
      expect(screen.queryByRole('menu', { name: /Stats widgets/ })).toBeNull()
    })

    it('Esc with flyout open closes only the flyout (one Escape, one level)', () => {
      const onClose = vi.fn()
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="notes"
          onChangeKind={() => {}}
          onClose={onClose}
        />,
      )
      const statsRow = screen.getByRole('menuitem', { name: /^Stats/ })
      fireEvent.pointerEnter(statsRow)
      fireEvent.keyDown(screen.getByRole('menu', { name: /Change widget/ }), { key: 'Escape' })
      expect(screen.queryByRole('menu', { name: /Stats widgets/ })).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('picking a stats kind from the flyout fires onChangeKind + closes the menu', () => {
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
      fireEvent.pointerEnter(screen.getByRole('menuitem', { name: /^Stats/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: /Snooze graveyard/ }))
      expect(onChangeKind).toHaveBeenCalledWith('snoozeGraveyard')
      expect(onClose).toHaveBeenCalled()
    })

    it('opening Stats closes any open Change list flyout (only one flyout at a time — D8)', () => {
      render(
        <WidgetKindMenu
          anchor={ANCHOR}
          currentKind="lens"
          onChangeKind={() => {}}
          pickListForLens={() => {}}
          onClose={() => {}}
        />,
      )
      const listRow = screen.getByRole('menuitem', { name: /Change list/ })
      fireEvent.pointerEnter(listRow)
      expect(screen.getByRole('menu', { name: /Change list/i })).toBeInTheDocument()

      const statsRow = screen.getByRole('menuitem', { name: /^Stats/ })
      fireEvent.pointerEnter(statsRow)
      // The Change list flyout closes; only the Stats flyout remains.
      expect(screen.queryByRole('menu', { name: 'Change list' })).toBeNull()
      expect(screen.getByRole('menu', { name: /Stats widgets/ })).toBeInTheDocument()
    })
  })

  describe('Edit list opens the direct dialog (triage-2026-04-26 P5)', () => {
    beforeEach(() => {
      useUIStore.setState({
        listEditorDialogId: null,
        listsEditorOpen: false,
        listsEditorInitialId: null,
      })
    })

    it('clicking Edit list when bound to openListEditorDialog opens only the dialog (no Lists manager)', () => {
      const DEF_ID = 42
      // Mirrors the SlotRenderer / ListInsetNode call-site binding —
      // post-P5 the "Edit list" entry from a tab pill / float menu calls
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
