import { useLatestRef } from './use-latest-ref'
import { hasModalAbove, isInLayerAbove } from '../utils/dom-layers'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

const VIEWPORT_MARGIN_PX = 8
const DEFAULT_GAP_PX = 4

export type PopoverAnchor =
  | { kind: 'ref'; ref: RefObject<HTMLElement | null> }
  | { kind: 'point'; x: number; y: number }
  /**
   * A viewport rect the caller measures (e.g. the character box at a text
   * caret): the panel sits below it and flips above its top. Static like
   * `point` — the caller passes a new rect when it moves.
   */
  | { kind: 'rect'; left: number; top: number; right: number; bottom: number }

export type PopoverPlacement =
  | 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'
  /**
   * Centred on the anchor (a tooltip): below / above it, flipped like the
   * other `bottom-*` / `top-*` placements, then kept inside the viewport.
   */
  | 'bottom-center' | 'top-center'
  /**
   * Beside the anchor (a submenu panel next to its menu item): the panel's
   * top lines up with the anchor's top and it sits to the right, or to the
   * left (`left-start`) when the right side has no room. Near the bottom it
   * lines up with the anchor's bottom instead.
   */
  | 'right-start' | 'left-start'

export interface UsePopoverAnchorOptions {
  /**
   * Where the popover should attach. `ref` reads `getBoundingClientRect()`
   * from the trigger element each compute pass; `point` pins to viewport
   * coords (used by right-click / contextmenu popovers that have no element
   * trigger).
   */
  anchor: PopoverAnchor
  open: boolean
  /**
   * Initial placement. The hook flips axes when the panel would clip the
   * viewport: `bottom-*` flips to `top-*` if the panel would extend past the
   * bottom edge; `*-start` flips to `*-end` if the panel would extend past
   * the right edge; `right-start` flips to `left-start` (and back) when the
   * panel doesn't fit beside the anchor. Default `'bottom-start'`.
   */
  placement?: PopoverPlacement
  /** Gap (px) between anchor edge and panel. Default 4. */
  offset?: number
  /**
   * When `true` (default), an ancestor scroll fires `onClose` (capture phase
   * — catches scroll on widget bodies / `.runtimeFilterWrap` / etc). When
   * `false`, a `ref` anchor repositions the panel to track the element; a
   * `point` anchor is static and the listener becomes a no-op.
   */
  closeOnScroll?: boolean
  /**
   * When `true` (default), a window resize fires `onClose`. When `false`,
   * a `ref` anchor repositions; a `point` anchor is static.
   */
  closeOnResize?: boolean
  /**
   * When `true` (default), `Escape` fires `onClose` (document-level) — not
   * one pressed in a layer stacked above the panel (a dialog opened from it).
   */
  closeOnEscape?: boolean
  /**
   * The Escape that closes the popover stops there (`preventDefault` +
   * `stopPropagation` in the capture phase), so nothing behind it — e.g. a
   * dialog the trigger sits in — also handles it. Default `false`.
   */
  consumeEscape?: boolean
  /**
   * When `true` (default), a `mousedown` outside the panel + any element
   * registered via `extraInsideRefs` (and the trigger element if the anchor
   * is a `ref`) fires `onClose`. A press in a layer stacked above the panel
   * (a menu or a dialog opened while it is open) isn't outside.
   */
  closeOnOutsideClick?: boolean
  onClose: () => void
  /**
   * When `true` (default), a mousedown on a `ref` anchor counts as inside, so
   * the trigger's own click can toggle the popover. `false` for an anchor
   * that isn't the trigger (e.g. a whole row the panel is placed under): a
   * click on it then closes the popover like any outside click.
   */
  anchorIsInside?: boolean
  /**
   * Other elements that count as "inside" for outside-click detection. The
   * panel root is always inside; this is for nested flyouts (e.g.
   * `MenuPopover`'s submenus and panels) and wrapper rows whose
   * children should not dismiss the popover (e.g. `RuntimeFilterPicker`'s
   * field row containing the chips + input).
   */
  extraInsideRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
  /**
   * Changes when the panel's content changes size (e.g. a list narrowing as
   * the user types): the position is recomputed so the flip and clamp use
   * the new size.
   */
  contentKey?: string | number
  /**
   * Re-place the panel whenever it or a `ref` anchor changes size
   * (`ResizeObserver`), e.g. a picker's list narrowing as the user types or
   * an editor growing. Default `false`.
   */
  observeSize?: boolean
}

export interface PopoverStyle {
  readonly position: 'fixed'
  readonly left: number
  readonly top: number
  readonly maxWidth: number
  readonly maxHeight: number
}

export interface UsePopoverAnchorResult {
  /** Apply to the panel root via `<div ref={panelRef} style={style} />`. */
  panelRef: (el: HTMLElement | null) => void
  /** Inline style for the panel root. Spread or apply directly. */
  style: PopoverStyle
  /** Final placement after any flip. Useful for caret/arrow direction or aria. */
  placementUsed: PopoverPlacement
  /** `false` until the panel has been placed against its anchor (it waits off-screen). */
  placed: boolean
}

interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

function readAnchorRect(anchor: PopoverAnchor): AnchorRect | null {
  if (anchor.kind === 'point') {
    return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y }
  }
  if (anchor.kind === 'rect') {
    return { left: anchor.left, top: anchor.top, right: anchor.right, bottom: anchor.bottom }
  }
  const el = anchor.ref.current
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

function viewportSize(): { vw: number; vh: number } {
  return {
    vw: typeof window !== 'undefined' ? window.innerWidth : 0,
    vh: typeof window !== 'undefined' ? window.innerHeight : 0,
  }
}

/**
 * Off-screen initial position so the panel renders at its natural size on the
 * first commit (constrained by the consumer's CSS) without flashing at 0,0.
 * The first `compute()` then reads a real `getBoundingClientRect()` and the
 * flip/clamp branches engage. A `maxWidth/maxHeight` of 0 here is a footgun:
 * it forces the panel to 0×0, `compute()` reads 0, the `panelHeight > 0` gate
 * skips both flip and clamp, and the panel ends up positioned at the raw
 * anchor — clipping the bottom of the viewport for anchors near the bottom
 * (e.g. a cell's "+" → list picker near the bottom of the screen).
 */
const OFFSCREEN_PX = -9999

function makeInitialStyle(): PopoverStyle {
  const { vw, vh } = viewportSize()
  return {
    position: 'fixed',
    left: OFFSCREEN_PX,
    top: OFFSCREEN_PX,
    maxWidth: Math.max(0, vw - VIEWPORT_MARGIN_PX * 2),
    maxHeight: Math.max(0, vh - VIEWPORT_MARGIN_PX * 2),
  }
}

function styleEqual(a: PopoverStyle, b: PopoverStyle): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.maxWidth === b.maxWidth &&
    a.maxHeight === b.maxHeight
  )
}

/**
 * Pure placement math: anchor rect + measured panel size → fixed-position
 * style with viewport flip + clamp. Returns null when a `ref` anchor has no
 * element yet.
 */
function computePopoverPosition(
  anchor: PopoverAnchor,
  panel: HTMLElement | null,
  place: PopoverPlacement,
  off: number,
): { style: PopoverStyle; placement: PopoverPlacement } | null {
  const a = readAnchorRect(anchor)
  if (!a) return null
  const panelRect = panel?.getBoundingClientRect()
  const panelWidth = panelRect?.width ?? 0
  const panelHeight = panelRect?.height ?? 0
  const { vw, vh } = viewportSize()

  if (place === 'right-start' || place === 'left-start') {
    return besidePosition(a, panelWidth, panelHeight, place, off, vw, vh)
  }

  // ---- Y axis (bottom-* / top-*) ----
  const wantsBottom = place.startsWith('bottom')
  let placementY: 'top' | 'bottom' = wantsBottom ? 'bottom' : 'top'
  let top = wantsBottom ? a.bottom + off : a.top - panelHeight - off
  if (panelHeight > 0) {
    if (wantsBottom && top + panelHeight > vh - VIEWPORT_MARGIN_PX) {
      const flipped = a.top - panelHeight - off
      if (flipped >= VIEWPORT_MARGIN_PX) {
        top = flipped
        placementY = 'top'
      }
    } else if (!wantsBottom && top < VIEWPORT_MARGIN_PX) {
      const flipped = a.bottom + off
      if (flipped + panelHeight <= vh - VIEWPORT_MARGIN_PX) {
        top = flipped
        placementY = 'bottom'
      }
    }
    // Final clamp keeps a too-tall panel inside the viewport.
    const maxTop = vh - VIEWPORT_MARGIN_PX - panelHeight
    if (top > maxTop) top = Math.max(VIEWPORT_MARGIN_PX, maxTop)
    if (top < VIEWPORT_MARGIN_PX) top = VIEWPORT_MARGIN_PX
  }

  // ---- X axis (*-start / *-end / *-center) ----
  if (place.endsWith('center')) {
    let left = (a.left + a.right) / 2 - panelWidth / 2
    if (panelWidth > 0) {
      left = Math.min(left, vw - VIEWPORT_MARGIN_PX - panelWidth)
      left = Math.max(left, VIEWPORT_MARGIN_PX)
    }
    return {
      style: { position: 'fixed', left, top, maxWidth: vw - VIEWPORT_MARGIN_PX * 2, maxHeight: vh - VIEWPORT_MARGIN_PX * 2 },
      placement: `${placementY}-center`,
    }
  }
  const wantsStart = place.endsWith('start')
  let placementX: 'start' | 'end' = wantsStart ? 'start' : 'end'
  let left = wantsStart ? a.left : a.right - panelWidth
  if (panelWidth > 0) {
    if (wantsStart && left + panelWidth > vw - VIEWPORT_MARGIN_PX) {
      const flipped = a.right - panelWidth
      if (flipped >= VIEWPORT_MARGIN_PX) {
        left = flipped
        placementX = 'end'
      }
    } else if (!wantsStart && left < VIEWPORT_MARGIN_PX) {
      const flipped = a.left
      if (flipped + panelWidth <= vw - VIEWPORT_MARGIN_PX) {
        left = flipped
        placementX = 'start'
      }
    }
    const maxLeft = vw - VIEWPORT_MARGIN_PX - panelWidth
    if (left > maxLeft) left = Math.max(VIEWPORT_MARGIN_PX, maxLeft)
    if (left < VIEWPORT_MARGIN_PX) left = VIEWPORT_MARGIN_PX
  }

  const next: PopoverStyle = {
    position: 'fixed',
    left,
    top,
    maxWidth: vw - VIEWPORT_MARGIN_PX * 2,
    maxHeight: vh - VIEWPORT_MARGIN_PX * 2,
  }
  return {
    style: next,
    placement: `${placementY}-${placementX}` as PopoverPlacement,
  }
}

/** `right-start` / `left-start`: beside the anchor, flipped to the other side or up when it doesn't fit. */
function besidePosition(
  a: AnchorRect,
  panelWidth: number,
  panelHeight: number,
  place: 'right-start' | 'left-start',
  off: number,
  vw: number,
  vh: number,
): { style: PopoverStyle; placement: PopoverPlacement } {
  const rightLeft = a.right + off
  const leftLeft = a.left - off - panelWidth
  let side: 'right' | 'left' = place === 'right-start' ? 'right' : 'left'
  let left = side === 'right' ? rightLeft : leftLeft
  let top = a.top
  if (panelWidth > 0) {
    if (side === 'right' && rightLeft + panelWidth > vw - VIEWPORT_MARGIN_PX && leftLeft >= VIEWPORT_MARGIN_PX) {
      side = 'left'
      left = leftLeft
    } else if (side === 'left' && leftLeft < VIEWPORT_MARGIN_PX && rightLeft + panelWidth <= vw - VIEWPORT_MARGIN_PX) {
      side = 'right'
      left = rightLeft
    }
    left = Math.max(VIEWPORT_MARGIN_PX, Math.min(left, vw - VIEWPORT_MARGIN_PX - panelWidth))
  }
  if (panelHeight > 0) {
    if (top + panelHeight > vh - VIEWPORT_MARGIN_PX) top = a.bottom - panelHeight
    top = Math.max(VIEWPORT_MARGIN_PX, Math.min(top, vh - VIEWPORT_MARGIN_PX - panelHeight))
  }
  return {
    style: { position: 'fixed', left, top, maxWidth: vw - VIEWPORT_MARGIN_PX * 2, maxHeight: vh - VIEWPORT_MARGIN_PX * 2 },
    placement: side === 'right' ? 'right-start' : 'left-start',
  }
}

/**
 * Shared lifecycle hook for popover panels: anchor positioning + flip +
 * clamp + scroll/resize/Escape/outside-click dismissal.
 *
 * Caller owns the panel itself, including `createPortal` to `document.body`:
 *
 * ```tsx
 * const { panelRef, style } = usePopoverAnchor({
 *   anchor: { kind: 'ref', ref: triggerRef },
 *   open,
 *   onClose,
 * })
 * return open ? createPortal(
 *   <div ref={panelRef} style={style}>…</div>,
 *   document.body,
 * ) : null
 * ```
 *
 * Every anchored popover uses it (e.g. `MenuPopover` and its submenus,
 * `AnchoredPicker`, `RuntimeFilterPicker`, `TooltipBubble`, the `@ # /`
 * popups) instead of its own positioning effects.
 */
export function usePopoverAnchor(opts: UsePopoverAnchorOptions): UsePopoverAnchorResult {
  const {
    anchor,
    open,
    placement = 'bottom-start',
    offset = DEFAULT_GAP_PX,
    closeOnScroll = true,
    closeOnResize = true,
    closeOnEscape = true,
    consumeEscape = false,
    closeOnOutsideClick = true,
    anchorIsInside = true,
    onClose,
    extraInsideRefs,
    contentKey,
    observeSize = false,
  } = opts

  const [style, setStyle] = useState<PopoverStyle>(makeInitialStyle)
  const [placementUsed, setPlacementUsed] = useState<PopoverPlacement>(placement)
  const panelElRef = useRef<HTMLElement | null>(null)

  // Inputs are captured in refs so the callbacks below can stay stable
  // (empty-deps useCallback). Without this, every render produces a new
  // `anchor` object literal, which changes the compute / panelRef identity,
  // which in turn re-runs the layout effect and the callback ref — feeding
  // back into setState and looping. The refs are synced in layout effects
  // (declared here, before the compute effect below, so they run first);
  // the compute effect's deps carry the anchor's primitive identity so any
  // anchor / placement / offset change re-runs compute against fresh refs.
  const anchorRef = useLatestRef(anchor)
  const placementRef = useLatestRef(placement)
  const offsetRef = useLatestRef(offset)
  const onCloseRef = useLatestRef(onClose)
  const closeOnScrollRef = useLatestRef(closeOnScroll)
  const closeOnResizeRef = useLatestRef(closeOnResize)
  const extraInsideRefsRef = useLatestRef(extraInsideRefs)
  const consumeEscapeRef = useLatestRef(consumeEscape)
  const anchorIsInsideRef = useLatestRef(anchorIsInside)
  const anchorElRef = anchor.kind === 'ref' ? anchor.ref : null
  const anchorX = anchor.kind === 'point' ? anchor.x : anchor.kind === 'rect' ? anchor.left : null
  const anchorY = anchor.kind === 'point' ? anchor.y : anchor.kind === 'rect' ? anchor.top : null
  const anchorRight = anchor.kind === 'rect' ? anchor.right : null
  const anchorBottom = anchor.kind === 'rect' ? anchor.bottom : null

  const compute = useCallback(() => {
    const pos = computePopoverPosition(
      anchorRef.current,
      panelElRef.current,
      placementRef.current,
      offsetRef.current,
    )
    if (!pos) return
    // Bail out when the position didn't actually change. Without this guard,
    // a fresh callback-ref attach (which fires `compute()` immediately) can
    // commit an identical-but-not-`Object.is` style and trigger another
    // render, which re-creates the callback ref and loops.
    setStyle((prev) => (styleEqual(prev, pos.style) ? prev : pos.style))
    setPlacementUsed((prev) => (prev === pos.placement ? prev : pos.placement))
  }, [anchorRef, placementRef, offsetRef])

  // Stable callback ref. Calls compute *only* on attach (el !== null) so we
  // pick up the panel's measured size; React calls this with `null` on
  // detach, which we ignore for compute purposes. A ref attach runs before
  // this hook's layout effects, so the input refs may still hold the previous
  // render's values here — the layout effect below recomputes before paint.
  const panelRef = useCallback((el: HTMLElement | null) => {
    panelElRef.current = el
    if (el) compute()
  }, [compute])

  // useLayoutEffect runs synchronously after the commit that mounts the
  // panel, so the flip lands before paint. Re-runs when open / placement /
  // offset / anchor identity / content changes (compute itself reads the
  // synced refs).
  useLayoutEffect(() => {
    if (open) compute()
  }, [open, placement, offset, anchorElRef, anchorX, anchorY, anchorRight, anchorBottom, contentKey, compute])

  // Size changes of the panel / a ref anchor re-place it (flip and clamp use
  // the new size).
  useLayoutEffect(() => {
    if (!open || !observeSize || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => compute())
    if (panelElRef.current) ro.observe(panelElRef.current)
    const a = anchorRef.current
    if (a.kind === 'ref' && a.ref.current) ro.observe(a.ref.current)
    return () => ro.disconnect()
  }, [open, observeSize, anchorElRef, compute, anchorRef])

  // Scroll/resize listeners. Capture-phase scroll catches ancestors.
  useEffect(() => {
    if (!open) return
    const handleScroll = (e: Event) => {
      // Scroll inside the panel itself (e.g., a scrollable items list) is
      // intentional user navigation within the popover — don't dismiss on it.
      // Without this guard, dropdowns whose content overflows close the moment
      // the user wheel-scrolls or drags the inner scrollbar. The target may
      // be `window` / `document` for page scrolls, hence the Node check.
      const panel = panelElRef.current
      if (panel && e.target instanceof Node && panel.contains(e.target)) return
      if (closeOnScrollRef.current) {
        onCloseRef.current()
        return
      }
      if (anchorRef.current.kind === 'ref') compute()
    }
    const handleResize = () => {
      if (closeOnResizeRef.current) {
        onCloseRef.current()
        return
      }
      if (anchorRef.current.kind === 'ref') compute()
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleResize)
    }
  }, [open, compute, anchorRef, onCloseRef, closeOnScrollRef, closeOnResizeRef])

  // Escape close (document-level so it works even if focus has left the panel).
  useEffect(() => {
    if (!open || !closeOnEscape) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Pressed in a layer stacked above, or with nothing focused while a
      // dialog is open above: that layer's key.
      const panel = panelElRef.current
      if (panel && e.target instanceof Node && !panel.contains(e.target)
        && (isInLayerAbove(panel, e.target) || hasModalAbove(panel))) return
      if (consumeEscapeRef.current) {
        e.preventDefault()
        e.stopPropagation()
      }
      onCloseRef.current()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, closeOnEscape, onCloseRef, consumeEscapeRef])

  // Outside-click (capture phase to beat descendant stopPropagation).
  useEffect(() => {
    if (!open || !closeOnOutsideClick) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      const panel = panelElRef.current
      if (panel && panel.contains(target)) return
      if (panel && isInLayerAbove(panel, target)) return
      const extras = extraInsideRefsRef.current
      if (extras) {
        for (const ref of extras) {
          if (ref.current && ref.current.contains(target)) return
        }
      }
      // Trigger element clicks usually mean "toggle" — let the trigger's own
      // handler decide rather than racing it from here.
      const a = anchorRef.current
      if (anchorIsInsideRef.current && a.kind === 'ref' && a.ref.current && a.ref.current.contains(target)) {
        return
      }
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open, closeOnOutsideClick, anchorRef, onCloseRef, extraInsideRefsRef, anchorIsInsideRef])

  return { panelRef, style, placementUsed, placed: style.left !== OFFSCREEN_PX }
}
