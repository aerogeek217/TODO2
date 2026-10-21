import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { useCallback, useRef } from 'react'
import { usePopoverAnchor, type PopoverAnchor } from '../../hooks/use-popover-anchor'
import { useLatestRef } from '../../hooks/use-latest-ref'

/**
 * Hook unit tests cover the math (flip / clamp) and the lifecycle (scroll /
 * resize / Escape / outside-click). The math relies on
 * `getBoundingClientRect()`, which JSDOM stubs as a 0×0 rect — tests fake
 * the rect via `Object.defineProperty(element, 'getBoundingClientRect', …)`
 * for both the anchor (when `kind: 'ref'`) and the panel.
 */

const VIEWPORT_W = 1024
const VIEWPORT_H = 768

// Stubbed, not redefined: later files in a shared worker get jsdom's own size back.
beforeEach(() => {
  vi.stubGlobal('innerWidth', VIEWPORT_W)
  vi.stubGlobal('innerHeight', VIEWPORT_H)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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
    vi.stubGlobal('innerHeight', 300)
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

  it('does NOT close on a scroll in its own flyout or in a layer stacked above it (a submenu’s list); a page scroll still closes it', () => {
    const onClose = vi.fn()
    const { getByTestId } = render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={true}
        onClose={onClose}
        insideTestId="flyout"
        panelRect={{ width: 100, height: 100 }}
      />,
    )
    fireEvent.scroll(getByTestId('flyout'))
    const layer = document.createElement('div')
    const list = document.createElement('div')
    layer.appendChild(list)
    document.body.appendChild(layer)
    fireEvent.scroll(list)
    expect(onClose).not.toHaveBeenCalled()
    layer.remove()
    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalledTimes(1)
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

describe('usePopoverAnchor — anchor changes (refs synced in layout effects)', () => {
  it('re-positions when a point anchor moves while open', () => {
    const { getByTestId, rerender } = render(
      <Harness
        anchor={{ kind: 'point', x: 100, y: 200 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 150 }}
      />,
    )
    rerender(
      <Harness
        anchor={{ kind: 'point', x: 300, y: 100 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 150 }}
      />,
    )
    const panel = getByTestId('panel')
    expect(panel.style.left).toBe('300px')
    expect(panel.style.top).toBe('104px')
  })

  it('opens at the new point when the anchor changes in the same render as open', () => {
    const { getByTestId, rerender } = render(
      <Harness
        anchor={{ kind: 'point', x: 10, y: 10 }}
        open={false}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 150 }}
      />,
    )
    rerender(
      <Harness
        anchor={{ kind: 'point', x: 400, y: 300 }}
        open={true}
        onClose={vi.fn()}
        panelRect={{ width: 200, height: 150 }}
      />,
    )
    const panel = getByTestId('panel')
    expect(panel.style.left).toBe('400px')
    expect(panel.style.top).toBe('304px')
  })

  it('calls the latest onClose after a re-render swaps the callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <Harness anchor={{ kind: 'point', x: 0, y: 0 }} open={true} onClose={first} />,
    )
    rerender(<Harness anchor={{ kind: 'point', x: 0, y: 0 }} open={true} onClose={second} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('usePopoverAnchor — rect anchor + contentKey', () => {
  /** A panel whose ref callback is stable, so only the hook's own deps recompute. */
  function RectHarness({ anchor, size, contentKey }: {
    anchor: PopoverAnchor
    size: { width: number; height: number }
    contentKey?: string
  }) {
    // Synced before the hook's own layout effect re-measures.
    const sizeRef = useLatestRef(size)
    const { panelRef, style, placementUsed } = usePopoverAnchor({
      anchor, open: true, onClose: () => {}, contentKey,
    })
    const setPanel = useCallback((el: HTMLDivElement | null) => {
      if (el) {
        Object.defineProperty(el, 'getBoundingClientRect', {
          configurable: true,
          value: () => makeRect(0, 0, sizeRef.current.width, sizeRef.current.height),
        })
      }
      panelRef(el)
    }, [panelRef, sizeRef])
    return <div ref={setPanel} data-testid="panel" data-placement={placementUsed} style={style}>panel</div>
  }

  it('sits below the rect, left-aligned with it', () => {
    const { getByTestId } = render(
      <RectHarness anchor={{ kind: 'rect', left: 100, top: 200, right: 108, bottom: 222 }} size={{ width: 200, height: 150 }} />,
    )
    expect(getByTestId('panel').style.top).toBe('226px')
    expect(getByTestId('panel').style.left).toBe('100px')
  })

  it('flips above the rect top (not over it) near the bottom edge', () => {
    const { getByTestId } = render(
      <RectHarness anchor={{ kind: 'rect', left: 100, top: 680, right: 108, bottom: 702 }} size={{ width: 200, height: 150 }} />,
    )
    expect(getByTestId('panel').dataset.placement).toBe('top-start')
    expect(getByTestId('panel').style.top).toBe('526px') // 680 - 150 - 4
  })

  it('a new contentKey re-measures the panel (it flips once it grew)', () => {
    const anchor: PopoverAnchor = { kind: 'rect', left: 100, top: 680, right: 108, bottom: 702 }
    const { getByTestId, rerender } = render(
      <RectHarness anchor={anchor} size={{ width: 200, height: 40 }} contentKey="a" />,
    )
    expect(getByTestId('panel').style.top).toBe('706px')
    rerender(<RectHarness anchor={anchor} size={{ width: 200, height: 150 }} contentKey="b" />)
    expect(getByTestId('panel').style.top).toBe('526px')
  })
})

describe('usePopoverAnchor — beside the anchor (right-start)', () => {
  function BesideHarness({ anchor, size }: { anchor: PopoverAnchor; size: { width: number; height: number } }) {
    const { panelRef, style, placementUsed } = usePopoverAnchor({
      anchor, open: true, onClose: () => {}, placement: 'right-start', offset: 2,
    })
    const setPanel = useCallback((el: HTMLDivElement | null) => {
      if (el) {
        Object.defineProperty(el, 'getBoundingClientRect', {
          configurable: true,
          value: () => makeRect(0, 0, size.width, size.height),
        })
      }
      panelRef(el)
    }, [panelRef, size.width, size.height])
    return <div ref={setPanel} data-testid="panel" data-placement={placementUsed} style={style}>panel</div>
  }

  it('sits to the right of the anchor, tops aligned', () => {
    const { getByTestId } = render(
      <BesideHarness anchor={{ kind: 'rect', left: 100, top: 200, right: 300, bottom: 228 }} size={{ width: 316, height: 200 }} />,
    )
    expect(getByTestId('panel').style.left).toBe('302px')
    expect(getByTestId('panel').style.top).toBe('200px')
    expect(getByTestId('panel').dataset.placement).toBe('right-start')
  })

  it('flips to the left side when the right has no room', () => {
    const { getByTestId } = render(
      <BesideHarness anchor={{ kind: 'rect', left: 600, top: 200, right: 800, bottom: 228 }} size={{ width: 316, height: 200 }} />,
    )
    expect(getByTestId('panel').style.left).toBe('282px') // 600 - 2 - 316
    expect(getByTestId('panel').dataset.placement).toBe('left-start')
  })

  it('near the bottom, lines up with the anchor’s bottom instead', () => {
    const { getByTestId } = render(
      <BesideHarness anchor={{ kind: 'rect', left: 100, top: 700, right: 300, bottom: 728 }} size={{ width: 316, height: 200 }} />,
    )
    expect(getByTestId('panel').style.top).toBe('528px') // 728 - 200
  })
})

describe('usePopoverAnchor — centred placements, placed flag, Escape and anchor options', () => {
  function OptionsHarness({ anchor, size, placement, onClose = () => {}, consumeEscape, anchorIsInside, observeSize }: {
    anchor: PopoverAnchor
    size: { width: number; height: number }
    placement?: 'bottom-center' | 'top-center' | 'bottom-start'
    onClose?: () => void
    consumeEscape?: boolean
    anchorIsInside?: boolean
    observeSize?: boolean
  }) {
    const sizeRef = useLatestRef(size)
    const { panelRef, style, placementUsed, placed } = usePopoverAnchor({
      anchor, open: true, onClose, placement, offset: 6, consumeEscape, anchorIsInside, observeSize,
    })
    const setPanel = useCallback((el: HTMLDivElement | null) => {
      if (el) {
        Object.defineProperty(el, 'getBoundingClientRect', {
          configurable: true,
          value: () => makeRect(0, 0, sizeRef.current.width, sizeRef.current.height),
        })
      }
      panelRef(el)
    }, [panelRef, sizeRef])
    return <div ref={setPanel} data-testid="panel" data-placement={placementUsed} data-placed={placed} style={style}>panel</div>
  }

  it('bottom-center centres the panel under the anchor', () => {
    const { getByTestId } = render(
      <OptionsHarness anchor={{ kind: 'rect', left: 400, top: 100, right: 440, bottom: 120 }} size={{ width: 100, height: 30 }} placement="bottom-center" />,
    )
    const panel = getByTestId('panel')
    expect(panel.style.left).toBe('370px') // 420 - 50
    expect(panel.style.top).toBe('126px')
    expect(panel.dataset.placement).toBe('bottom-center')
    expect(panel.dataset.placed).toBe('true')
  })

  it('bottom-center flips above near the bottom and is clamped at the side edges', () => {
    const { getByTestId } = render(
      <OptionsHarness anchor={{ kind: 'rect', left: 1000, top: 740, right: 1020, bottom: 760 }} size={{ width: 100, height: 30 }} placement="bottom-center" />,
    )
    const panel = getByTestId('panel')
    expect(panel.dataset.placement).toBe('top-center')
    expect(panel.style.top).toBe('704px') // 740 - 30 - 6
    expect(panel.style.left).toBe('916px') // 1024 - 8 - 100
  })

  it('placed is false while a ref anchor has no element yet', () => {
    function NoElement() {
      const ref = useRef<HTMLElement | null>(null)
      return <OptionsHarness anchor={{ kind: 'ref', ref }} size={{ width: 100, height: 30 }} />
    }
    const { getByTestId } = render(<NoElement />)
    expect(getByTestId('panel').dataset.placed).toBe('false')
  })

  it('consumeEscape stops the Escape that closes it', () => {
    const onClose = vi.fn()
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    try {
      render(<OptionsHarness anchor={{ kind: 'point', x: 10, y: 10 }} size={{ width: 100, height: 30 }} onClose={onClose} consumeEscape />)
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
      expect(behind).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', behind)
    }
  })

  it('without consumeEscape the Escape goes on to other listeners', () => {
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    try {
      render(<OptionsHarness anchor={{ kind: 'point', x: 10, y: 10 }} size={{ width: 100, height: 30 }} />)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      expect(behind).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', behind)
    }
  })

  it('anchorIsInside={false}: a mousedown on the anchor closes it', () => {
    function RowAnchor({ onClose }: { onClose: () => void }) {
      const ref = useRef<HTMLDivElement | null>(null)
      return (
        <>
          <div ref={ref} data-testid="row">row</div>
          <OptionsHarness anchor={{ kind: 'ref', ref }} size={{ width: 100, height: 30 }} onClose={onClose} anchorIsInside={false} />
        </>
      )
    }
    const onClose = vi.fn()
    const { getByTestId } = render(<RowAnchor onClose={onClose} />)
    fireEvent.mouseDown(getByTestId('row'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('observeSize re-places the panel when it changes size', () => {
    const callbacks: Array<() => void> = []
    const observed: Element[] = []
    class FakeResizeObserver {
      constructor(cb: () => void) { callbacks.push(cb) }
      observe(el: Element) { observed.push(el) }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    try {
      const size = { width: 200, height: 40 }
      const anchor: PopoverAnchor = { kind: 'rect', left: 100, top: 680, right: 108, bottom: 702 }
      const { getByTestId } = render(<OptionsHarness anchor={anchor} size={size} observeSize />)
      expect(getByTestId('panel').style.top).toBe('708px')
      expect(observed).toContain(getByTestId('panel'))
      size.height = 150
      act(() => { for (const cb of callbacks) cb() })
      expect(getByTestId('panel').style.top).toBe('524px') // 680 - 150 - 6
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('usePopoverAnchor — layers stacked above the panel', () => {
  const layers: HTMLElement[] = []
  /** A portal root added to the body: after the panel's (opened later) or before it. */
  function addLayer(where: 'after' | 'before'): HTMLElement {
    const layer = document.createElement('div')
    layers.push(layer)
    const button = document.createElement('button')
    layer.appendChild(button)
    if (where === 'after') document.body.appendChild(layer)
    else document.body.insertBefore(layer, document.body.firstChild)
    return button
  }

  afterEach(() => {
    for (const layer of layers.splice(0)) layer.remove()
  })

  it('a mousedown in a layer opened later (a menu or dialog over it) does not close it; one in an earlier layer does', () => {
    const onClose = vi.fn()
    render(<Harness anchor={{ kind: 'point', x: 10, y: 10 }} open onClose={onClose} panelRect={{ width: 100, height: 100 }} />)
    fireEvent.mouseDown(addLayer('after'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(addLayer('before'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an Escape pressed in a layer opened later is that layer’s; one with nothing focused closes it', () => {
    const onClose = vi.fn()
    render(<Harness anchor={{ kind: 'point', x: 10, y: 10 }} open onClose={onClose} panelRect={{ width: 100, height: 100 }} />)
    fireEvent.keyDown(addLayer('after'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('an Escape with nothing focused while a dialog is open above is the dialog’s', () => {
    const onClose = vi.fn()
    render(<Harness anchor={{ kind: 'point', x: 10, y: 10 }} open onClose={onClose} panelRect={{ width: 100, height: 100 }} />)
    const dialog = addLayer('after').parentElement!
    dialog.setAttribute('aria-modal', 'true')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    dialog.removeAttribute('aria-modal')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
