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

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

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
   * the right edge. Default `'bottom-start'`.
   */
  placement?: PopoverPlacement
  /** Gap (px) between anchor edge and panel. Default 4. */
  offset?: number
  /**
   * When `true` (default), an ancestor scroll fires `onClose` (capture phase
   * — catches scroll on inset bodies / `.runtimeFilterWrap` / etc). When
   * `false`, a `ref` anchor repositions the panel to track the element; a
   * `point` anchor is static and the listener becomes a no-op.
   */
  closeOnScroll?: boolean
  /**
   * When `true` (default), a window resize fires `onClose`. When `false`,
   * a `ref` anchor repositions; a `point` anchor is static.
   */
  closeOnResize?: boolean
  /** When `true` (default), `Escape` fires `onClose` (document-level). */
  closeOnEscape?: boolean
  /**
   * When `true` (default), a `mousedown` outside the panel + any element
   * registered via `extraInsideRefs` (and the trigger element if the anchor
   * is a `ref`) fires `onClose`.
   */
  closeOnOutsideClick?: boolean
  onClose: () => void
  /**
   * Other elements that count as "inside" for outside-click detection. The
   * panel root is always inside; this is for nested flyouts (e.g.
   * `WidgetKindMenu`'s Stats / Change-list submenus) and wrapper rows whose
   * children should not dismiss the popover (e.g. `RuntimeFilterPicker`'s
   * field row containing the chips + input).
   */
  extraInsideRefs?: ReadonlyArray<RefObject<HTMLElement | null>>
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

const INITIAL_STYLE: PopoverStyle = {
  position: 'fixed',
  left: 0,
  top: 0,
  maxWidth: 0,
  maxHeight: 0,
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
 * Replaces the per-popover positioning useEffects in `RuntimeFilterPicker`
 * (canonical, post-triage P3), `ListDefinitionPickerPopup`,
 * `WidgetKindMenu`, `FilteredListPopup`, `SlotMenu`, `CanvasContextMenu`,
 * and `ProjectPickerPopup` (all migrated in ui-consistency P1).
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
    closeOnOutsideClick = true,
    onClose,
    extraInsideRefs,
  } = opts

  const [style, setStyle] = useState<PopoverStyle>(INITIAL_STYLE)
  const [placementUsed, setPlacementUsed] = useState<PopoverPlacement>(placement)
  const panelElRef = useRef<HTMLElement | null>(null)

  // Inputs are captured in refs so the callbacks below can stay stable
  // (empty-deps useCallback). Without this, every render produces a new
  // `anchor` object literal, which changes the compute / panelRef identity,
  // which in turn re-runs the layout effect and the callback ref — feeding
  // back into setState and looping. The trade-off is that compute reads
  // *current* refs, so any prop change is picked up on the next compute
  // call (driven by useLayoutEffect's `open`/`placement` deps).
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const placementRef = useRef(placement)
  placementRef.current = placement
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closeOnScrollRef = useRef(closeOnScroll)
  closeOnScrollRef.current = closeOnScroll
  const closeOnResizeRef = useRef(closeOnResize)
  closeOnResizeRef.current = closeOnResize
  const extraInsideRefsRef = useRef(extraInsideRefs)
  extraInsideRefsRef.current = extraInsideRefs

  const compute = useCallback(() => {
    const a = readAnchorRect(anchorRef.current)
    if (!a) return
    const panel = panelElRef.current
    const panelRect = panel?.getBoundingClientRect()
    const panelWidth = panelRect?.width ?? 0
    const panelHeight = panelRect?.height ?? 0
    const { vw, vh } = viewportSize()
    const place = placementRef.current
    const off = offsetRef.current

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

    // ---- X axis (*-start / *-end) ----
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
    // Bail out when the position didn't actually change. Without this guard,
    // a fresh callback-ref attach (which fires `compute()` immediately) can
    // commit an identical-but-not-`Object.is` style and trigger another
    // render, which re-creates the callback ref and loops.
    setStyle((prev) => (styleEqual(prev, next) ? prev : next))
    const nextPlacement = `${placementY}-${placementX}` as PopoverPlacement
    setPlacementUsed((prev) => (prev === nextPlacement ? prev : nextPlacement))
  }, [])

  // Stable callback ref. Calls compute *only* on attach (el !== null) so we
  // pick up the panel's measured size; React calls this with `null` on
  // detach, which we ignore for compute purposes.
  const panelRef = useCallback((el: HTMLElement | null) => {
    panelElRef.current = el
    if (el) compute()
  }, [compute])

  // useLayoutEffect runs synchronously after the commit that mounts the
  // panel, so the flip lands before paint. Re-runs when placement / open
  // changes (the props watch is via the ref reads inside compute).
  useLayoutEffect(() => {
    if (open) compute()
  }, [open, placement, compute])

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
  }, [open, compute])

  // Escape close (document-level so it works even if focus has left the panel).
  useEffect(() => {
    if (!open || !closeOnEscape) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, closeOnEscape])

  // Outside-click (capture phase to beat descendant stopPropagation).
  useEffect(() => {
    if (!open || !closeOnOutsideClick) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (!target) return
      const panel = panelElRef.current
      if (panel && panel.contains(target)) return
      const extras = extraInsideRefsRef.current
      if (extras) {
        for (const ref of extras) {
          if (ref.current && ref.current.contains(target)) return
        }
      }
      // Trigger element clicks usually mean "toggle" — let the trigger's own
      // handler decide rather than racing it from here.
      const a = anchorRef.current
      if (a.kind === 'ref' && a.ref.current && a.ref.current.contains(target)) {
        return
      }
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open, closeOnOutsideClick])

  return { panelRef, style, placementUsed }
}
