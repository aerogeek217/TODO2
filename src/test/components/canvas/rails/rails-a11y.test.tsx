import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SlotMenu } from '../../../../components/canvas/rails/SlotMenu'
import { SlotHeader } from '../../../../components/canvas/rails/SlotHeader'
import { DockOverlay } from '../../../../components/canvas/rails/DockOverlay'
import { DndContext } from '@dnd-kit/core'

afterEach(cleanup)

describe('SlotHeader a11y', () => {
  it('labels the menu trigger and close button with the slot kind', () => {
    render(
      <SlotHeader
        slotKind="lens"
        title="My lens"
        onMore={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByLabelText('list options')).toBeInTheDocument()
    expect(screen.getByLabelText('Close list')).toBeInTheDocument()
    expect(screen.getByLabelText('Reorder slot: list')).toBeInTheDocument()
  })

  it('reflects menu open state on aria-expanded', () => {
    const { rerender } = render(
      <SlotHeader slotKind="notes" title="Notes" onMore={() => {}} menuOpen={false} />,
    )
    expect(screen.getByLabelText('notes options')).toHaveAttribute('aria-expanded', 'false')
    rerender(<SlotHeader slotKind="notes" title="Notes" onMore={() => {}} menuOpen={true} />)
    expect(screen.getByLabelText('notes options')).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('SlotMenu keyboard nav', () => {
  it('focuses the first enabled item on open', () => {
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="lens"
        onSplit={() => {}}
        onClose={() => {}}
      />,
    )
    // Post-P3: kind switching moved to WidgetKindMenu; first enabled here is "Split above".
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Split above' }))
  })

  it('moves focus with ArrowDown / ArrowUp and wraps', () => {
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="lens"
        onSplit={() => {}}
        onClose={() => {}}
      />,
    )
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Split below' }))
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Split above' }))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="lens"
        onSplit={() => {}}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('has an aria-label referencing the slot kind', () => {
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="calendar"
        onSplit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menu', { name: 'calendar slot options' })).toBeInTheDocument()
  })
})

describe('DockOverlay a11y', () => {
  it('labels each drop zone', () => {
    render(
      <DndContext>
        <DockOverlay emptySides={['left', 'top']} />
      </DndContext>,
    )
    expect(screen.getByRole('button', { name: 'Dock to left rail' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dock to top rail' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Rail drop zones' })).toBeInTheDocument()
  })
})
