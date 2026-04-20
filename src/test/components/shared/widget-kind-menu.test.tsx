import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { WidgetKindMenu } from '../../../components/shared/WidgetKindMenu'

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

  it('shows a secondary "Change list…" row only when current kind is lens', () => {
    const { rerender } = render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="notes"
        onChangeKind={() => {}}
        onOpenSecondary={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /Change list/ })).toBeNull()

    rerender(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="lens"
        onChangeKind={() => {}}
        onOpenSecondary={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: /Change list/ })).toBeInTheDocument()
  })

  it('shows a secondary "Change taskboard…" row when current kind is taskboard', () => {
    render(
      <WidgetKindMenu
        anchor={ANCHOR}
        currentKind="taskboard"
        onChangeKind={() => {}}
        onOpenSecondary={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: /Change taskboard/ })).toBeInTheDocument()
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
})
