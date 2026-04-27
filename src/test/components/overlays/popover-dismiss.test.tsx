import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { CanvasContextMenu } from '../../../components/overlays/CanvasContextMenu'
import { ProjectPickerPopup } from '../../../components/overlays/ProjectPickerPopup'
import { SlotMenu } from '../../../components/canvas/rails/SlotMenu'

afterEach(cleanup)

/**
 * ui-consistency P1: every popover migrated to `usePopoverAnchor` shares
 * the same dismissal contract. The four already-portalized popovers stay
 * substitutional (no scroll/resize close); the three previously-inline
 * popovers (SlotMenu, CanvasContextMenu, ProjectPickerPopup) GAIN portal +
 * scroll/resize/Escape/outside-click close.
 *
 * `RuntimeFilterPicker` and `ListDefinitionPickerPopup` already had
 * dedicated test files; this file fills the gap for the three inline ones
 * + adds a scroll-close test for the freshly-portalized popovers.
 */

describe('CanvasContextMenu — post-migration dismissal', () => {
  it('mounts via internal createPortal (no outer wrapper required)', () => {
    render(
      <CanvasContextMenu
        x={50}
        y={50}
        items={[{ label: 'Item A', action: vi.fn() }]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('menuitem', { name: 'Item A' })).toBeInTheDocument()
  })

  it('outside-click closes', () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="outside" />
        <CanvasContextMenu
          x={50}
          y={50}
          items={[{ label: 'A', action: vi.fn() }]}
          onClose={onClose}
        />
      </>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    render(
      <CanvasContextMenu
        x={50}
        y={50}
        items={[{ label: 'A', action: vi.fn() }]}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('scroll closes (gained via portal migration — point-anchored menus go stale on scroll)', () => {
    const onClose = vi.fn()
    render(
      <CanvasContextMenu
        x={50}
        y={50}
        items={[{ label: 'A', action: vi.fn() }]}
        onClose={onClose}
      />,
    )
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('resize closes (gained via portal migration)', () => {
    const onClose = vi.fn()
    render(
      <CanvasContextMenu
        x={50}
        y={50}
        items={[{ label: 'A', action: vi.fn() }]}
        onClose={onClose}
      />,
    )
    fireEvent(window, new Event('resize'))
    expect(onClose).toHaveBeenCalled()
  })

  it('item click fires action and onClose', () => {
    const action = vi.fn()
    const onClose = vi.fn()
    render(
      <CanvasContextMenu
        x={50}
        y={50}
        items={[{ label: 'Click me', action }]}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Click me' }))
    expect(action).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ProjectPickerPopup — post-migration dismissal', () => {
  it('mounts via internal createPortal (no outer wrapper required)', () => {
    render(
      <ProjectPickerPopup
        x={50}
        y={50}
        projectId={undefined}
        projects={[{ id: 1, name: 'Alpha' }]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('outside-click closes', () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="outside" />
        <ProjectPickerPopup
          x={50}
          y={50}
          projectId={undefined}
          projects={[{ id: 1, name: 'Alpha' }]}
          onSelect={vi.fn()}
          onClose={onClose}
        />
      </>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape closes', () => {
    const onClose = vi.fn()
    render(
      <ProjectPickerPopup
        x={50}
        y={50}
        projectId={undefined}
        projects={[{ id: 1, name: 'Alpha' }]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('scroll closes (gained via portal migration)', () => {
    const onClose = vi.fn()
    render(
      <ProjectPickerPopup
        x={50}
        y={50}
        projectId={undefined}
        projects={[{ id: 1, name: 'Alpha' }]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('resize closes (gained via portal migration)', () => {
    const onClose = vi.fn()
    render(
      <ProjectPickerPopup
        x={50}
        y={50}
        projectId={undefined}
        projects={[{ id: 1, name: 'Alpha' }]}
        onSelect={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent(window, new Event('resize'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('SlotMenu — post-migration dismissal', () => {
  it('mounts via internal createPortal (no outer wrapper required)', () => {
    render(
      <SlotMenu
        anchor={{ x: 50, y: 50 }}
        currentKind="lens"
        orientation="vertical"
        onSplit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('menu', { name: /list slot options/i })).toBeInTheDocument()
  })

  it('outside-click closes', () => {
    const onClose = vi.fn()
    render(
      <>
        <div data-testid="outside" />
        <SlotMenu
          anchor={{ x: 50, y: 50 }}
          currentKind="lens"
          orientation="vertical"
          onSplit={vi.fn()}
          onClose={onClose}
        />
      </>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalled()
  })

  it('scroll closes (gained via portal migration)', () => {
    const onClose = vi.fn()
    render(
      <SlotMenu
        anchor={{ x: 50, y: 50 }}
        currentKind="lens"
        orientation="vertical"
        onSplit={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('resize closes (gained via portal migration)', () => {
    const onClose = vi.fn()
    render(
      <SlotMenu
        anchor={{ x: 50, y: 50 }}
        currentKind="lens"
        orientation="vertical"
        onSplit={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent(window, new Event('resize'))
    expect(onClose).toHaveBeenCalled()
  })
})
