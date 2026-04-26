import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SlotMenu } from '../../../../components/canvas/rails/SlotMenu'
import { DockOverlay } from '../../../../components/canvas/rails/DockOverlay'
import { DndContext } from '@dnd-kit/core'

afterEach(cleanup)

describe('SlotMenu keyboard nav', () => {
  it('focuses the first enabled item on open', () => {
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="lens"
        orientation="vertical"
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
        orientation="vertical"
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
        orientation="vertical"
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
        orientation="vertical"
        onSplit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menu', { name: 'Calendar slot options' })).toBeInTheDocument()
  })

  it('shows only above/below splits in vertical rails', () => {
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="lens"
        orientation="vertical"
        onSplit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Split above' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Split below' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Split left' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Split right' })).not.toBeInTheDocument()
  })

  it('shows only left/right splits in horizontal rails', () => {
    render(
      <SlotMenu
        anchor={{ x: 0, y: 0 }}
        currentKind="lens"
        orientation="horizontal"
        onSplit={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Split left' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Split right' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Split above' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Split below' })).not.toBeInTheDocument()
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
