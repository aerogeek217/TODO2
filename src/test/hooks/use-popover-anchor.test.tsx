import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { useRef } from 'react'
import { usePopoverAnchor, type PopoverAnchor } from '../../hooks/use-popover-anchor'

/**
 * Hook unit tests cover the math (flip / clamp) and the lifecycle (scroll /
 * resize / Escape / outside-click). The math relies on
 * `getBoundingClientRect()`, which JSDOM stubs as a 0×0 rect — tests fake
 * the rect via `Object.defineProperty(element, 'getBoundingClientRect', …)`
 * for both the anchor (when `kind: 'ref'`) and the panel.
 */

const VIEWPORT_W = 1024
const VIEWPORT_H = 768

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: VIEWPORT_W, writable: true, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: VIEWPORT_H, writable: true, configurable: true })
})

afterEach(cleanup)

interface HarnessProps {
  anchor: PopoverAnchor
  open: boolean
  onClose: () => void
  closeOnScroll?: boolean
  closeOnResize?: boolean
  closeOnEscape?: boolean
  closeOnOutsideClick?: boolean
  panelRect?: { width: number; height: number }
  insideTestId?: string
}

/**
 * Renders a panel through the hook. The panel's bounding rect is faked
 * before mount so flip/clamp branches see a non-zero size.
 */
function Harness({
  anchor,
  open,
  onClose,
  closeOnScroll,
  closeOnResize,
  closeOnEscape,
  closeOnOutsideClick,
  panelRect,
  insideTestId,
}: HarnessProps) {
  const insideRef = useRef<HTMLDivElement | null>(null)
  const { panelRef, style, placementUsed } = usePopoverAnchor({
    anchor,
    open,
    onClose,
    closeOnScroll,
    closeOnResize,
    closeOnEscape,
    closeOnOutsideClick,
    extraInsideRefs: insideTestId ? [insideRef] : undefined,
  })
  const setPanel = (el: HTMLDivElement | null) => {
    if (el && panelRect) {
      Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left: 0, top: 0, right: panelRect.width, bottom: panelRect.height,
          width: panelRect.width, height: panelRect.height, x: 0, y: 0, toJSON: () => ({}),
        } as DOMRect),
      })
    }
    panelRef(el)
  }
  return (
    <>
      {insideTestId && <div ref={insideRef} data-testid={insideTestId}>inside</div>}
      {open && (
        <div
          ref={setPanel}
          data-testid="panel"
          data-placement={placementUsed}
          style={style}
        >
          panel
        </div>
      )}
    </>
  )
}

function makeRect(left: number, top: number, w: number, h: number): DOMRect {
  return {
    left, top, right: left + w, bottom: top + h,
    width: w, height: h, x: left, y: top, toJSON: () => ({}),
  } as DOMRect
}

describe('usePopoverAnchor — positioning math', () => {
  it('point anchor + bottom-start positions panel at (x, y + offset)', () => {
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 100, y: 200 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 150 }}
      />,
    )
    const panel = getByTestId('panel')
    expect(panel.style.left).toBe('100px')
    expect(panel.style.top).toBe('204px') // 200 + 4 (default offset)
    expect(panel.dataset.placement).toBe('bottom-start')
  })

  it('flips bottom→top when the panel would clip the viewport bottom', () => {
    const { getByTestId } = render(
      <Harness
        // anchor near bottom: 700, panel height 150 → bottom-start would land at 704+150=854 > 760 (vh - 8).
        // top-start lands at 700 - 150 - 4 = 546, which fits.
        anchor={{ kind: 'point', x: 50, y: 700 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 150 }}
      />,
    )
    const panel = getByTestId('panel')
    expect(panel.dataset.placement).toBe('top-start')
    expect(panel.style.top).toBe('546px')
  })

  it('flips start→end when the panel would clip the viewport right', () => {
    const { getByTestId } = render(
      <Harness
        // anchor x=900, panel width 200 → bottom-start lands at 900..1100; viewport 1024 → clip.
        // Flip to bottom-end: left = anchor.right - panelWidth = 900 - 200 = 700.
        anchor={{ kind: 'point', x: 900, y: 100 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 80 }}
      />,
    )
    const panel = getByTestId('panel')
    expect(panel.dataset.placement).toBe('bottom-end')
    expect(panel.style.left).toBe('700px')
  })

  it('clamps a too-tall panel into the viewport with 8px margin', () => {
    Object.defineProperty(window, 'innerHeight', { value: 300, writable: true, configurable: true })
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 50, y: 50 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 100, height: 500 }}
      />,
    )
    const panel = getByTestId('panel')
    // 500-tall panel can't fit in 300-tall viewport — clamp top to VIEWPORT_MARGIN_PX.
    expect(panel.style.top).toBe('8px')
  })

  it('reads getBoundingClientRect from the trigger element when anchor.kind is "ref"', () => {
    function ElementHarness() {
      const triggerRef = useRef<HTMLDivElement | null>(null)
      const setTrigger = (el: HTMLDivElement | null) => {
        if (el) {
          Object.defineProperty(el, 'getBoundingClientRect', {
            configurable: true,
            value: () => makeRect(300, 400, 80, 24),
          })
        }
        triggerRef.current = el
      }
      return (
        <>
          <div ref={setTrigger} data-testid="trigger">trigger</div>
          <Harness
            anchor={{ kind: 'ref', ref: triggerRef }}
            open={true}
            onClose={vi.fn()}
            panelRect={{ width: 100, height: 50 }}
          />
        </>
      )
    }
    const { getByTestId } = render(<ElementHarness />)
    const panel = getByTestId('panel')
    // Panel attaches just below the trigger: top = 400 + 24 + 4 = 428, left = 300.
    expect(panel.style.top).toBe('428px')
    expect(panel.style.left).toBe('300px')
  })
})

describe('usePopoverAnchor — dismissal', () => {
  it('closes on scroll when closeOnScroll is true (default)', () => {
    const onClose = vi.fn()
    render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close on scroll inside the panel itself', () => {
    // Regression: when a popover's content area is itself scrollable (e.g.
    // FilterChipBar's `dropdownItemsScrollable` person list), the user
    // wheel-scrolling inside the panel used to dismiss it via the capture-
    // phase scroll listener. Internal scroll is intentional navigation, not
    // an ancestor reflow — keep the panel open.
    const onClose = vi.fn()
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    const panel = getByTestId('panel')
    // Capture-phase listener is attached on window; dispatch from inside the
    // panel and let it bubble.
    fireEvent.scroll(panel)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT close on scroll when closeOnScroll is false', () => {
    const onClose = vi.fn()
    render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        closeOnScroll={false}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent.scroll(window)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on window resize when closeOnResize is true (default)', () => {
    const onClose = vi.fn()
    render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent(window, new Event('resize'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape when closeOnEscape is true (default)', () => {
    const onClose = vi.fn()
    render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close on Escape when closeOnEscape is false', () => {
    const onClose = vi.fn()
    render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        closeOnEscape={false}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a mousedown outside the panel', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <>
        <div data-testid="outside">outside</div>
        <Harness
          anchor={{ kind: 'point', x: 10, y: 10 }}
          open={true}
          onClose={onClose}
          panelRect={{ width: 100, height: 100 }}
        />
      </>,
    )
    fireEvent.mouseDown(getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close on a mousedown inside the panel', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent.mouseDown(getByTestId('panel'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT close on a mousedown inside an element registered via extraInsideRefs', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        panelRect={{ width: 100, height: 100 }}
        insideTestId="extra-inside"
      />,
    )
    fireEvent.mouseDown(getByTestId('extra-inside'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT close on a mousedown on the trigger element when anchor is a ref', () => {
    function TriggerHarness({ onClose }: { onClose: () => void }) {
      const triggerRef = useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <button ref={triggerRef} data-testid="trigger">trigger</button>
          <Harness
            anchor={{ kind: 'ref', ref: triggerRef }}
            open={true}
            onClose={onClose}
            panelRect={{ width: 100, height: 100 }}
          />
        </>
      )
    }
    const onClose = vi.fn()
    const { getByTestId } = render(<TriggerHarness onClose={onClose} />)
    fireEvent.mouseDown(getByTestId('trigger'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does NOT install listeners when open is false', () => {
    const onClose = vi.fn()
    render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={false}
        onClose={onClose}
      />,
    )
    fireEvent.scroll(window)
    fireEvent(window, new Event('resize'))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('usePopoverAnchor — reposition mode', () => {
  it('reposition (closeOnScroll=false) tracks a ref anchor on scroll', () => {
    const onClose = vi.fn()
    let triggerRect = makeRect(100, 100, 80, 24)
    function ScrollHarness() {
      const triggerRef = useRef<HTMLDivElement | null>(null)
      const setTrigger = (el: HTMLDivElement | null) => {
        if (el) {
          Object.defineProperty(el, 'getBoundingClientRect', {
            configurable: true,
            value: () => triggerRect,
          })
        }
        triggerRef.current = el
      }
      return (
        <>
          <div ref={setTrigger} />
          <Harness
            anchor={{ kind: 'ref', ref: triggerRef }}
            open={true}
            onClose={onClose}
            closeOnScroll={false}
            closeOnResize={false}
            panelRect={{ width: 100, height: 50 }}
          />
        </>
      )
    }
    const { getByTestId } = render(<ScrollHarness />)
    const panel = getByTestId('panel')
    expect(panel.style.top).toBe('128px') // 100 + 24 + 4

    // Simulate the trigger scrolling up by 50px and a scroll event firing.
    triggerRect = makeRect(100, 50, 80, 24)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.top).toBe('78px') // 50 + 24 + 4
  })

  it('reposition mode is a no-op for point anchors (point is static)', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 50, y: 50 }}
        open={true}
        onClose={onClose}
        closeOnScroll={false}
        closeOnResize={false}
        panelRect={{ width: 100, height: 50 }}
      />,
    )
    const panel = getByTestId('panel')
    const initialTop = panel.style.top
    fireEvent.scroll(window)
    expect(onClose).not.toHaveBeenCalled()
    // Position unchanged — point coords are static.
    expect(panel.style.top).toBe(initialTop)
  })
})
