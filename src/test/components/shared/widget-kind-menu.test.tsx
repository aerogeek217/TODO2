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
