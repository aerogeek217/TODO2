import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TooltipBubble } from './TooltipBubble'
import { POPOVER_LEVEL_ATTR } from './popover-level'
import { registerModuleReset } from '../../utils/module-reset'

/** How long the pointer (or keyboard focus) rests on a trigger before its tooltip opens. */
export const TOOLTIP_DELAY_MS = 400

/**
 * The one tooltip showing (flair P9): `useTooltip`'s and `TooltipHost`'s
 * share it, so a trigger inside another (a chip's ×) never shows two
 * bubbles — the one opening closes the one showing.
 */
let openTooltip: (() => void) | null = null
registerModuleReset(() => { openTooltip = null })

/** A tooltip opens: the one showing, if another, closes (`close` is how this one closes). */
export function takeTooltipSlot(close: () => void): void {
  const showing = openTooltip
  openTooltip = close
  if (showing && showing !== close) showing()
}

/** A tooltip closed: the slot is free (only when it still holds this one). */
export function releaseTooltipSlot(close: () => void): void {
  if (openTooltip === close) openTooltip = null
}

/**
 * A popover is open (`data-popover-level`, every popover's root) over
 * `anchor`: a tooltip for something behind it (a row resting under the
 * pointer beside Edit list, an Add widget menu) would sit beside the popover
 * the user is working in, so it doesn't open (UX cleanup 1A). A popover
 * counts as over the anchor unless it holds it or comes before the
 * popover that does: popovers portal to the end of `<body>` as they open, so
 * the one opened last — a choice menu from the popup lists' group · sort
 * popover — is the one in use, and its items' tooltips open.
 */
export function popoverOpenElsewhere(anchor: HTMLElement): boolean {
  const own = anchor.closest(`[${POPOVER_LEVEL_ATTR}]`)
  for (const popover of document.querySelectorAll(`[${POPOVER_LEVEL_ATTR}]`)) {
    if (popover.contains(anchor)) continue
    if (own && own.compareDocumentPosition(popover) & Node.DOCUMENT_POSITION_PRECEDING) continue
    return true
  }
  return false
}

interface TooltipTriggerProps {
  onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onPointerDown: () => void
  onFocus: (e: React.FocusEvent<HTMLElement>) => void
  onBlur: () => void
  'aria-describedby'?: string
}

export interface UseTooltipResult {
  /** Spread on the trigger element. Empty when there is no text. */
  triggerProps: Partial<TooltipTriggerProps>
  /** Render next to the trigger (it portals to `<body>`). `null` while closed. */
  tooltip: React.ReactNode
}

/**
 * The app's tooltip: opens after {@link TOOLTIP_DELAY_MS} of hover or
 * keyboard focus on the trigger and closes on leave, blur, press, Escape or
 * scroll. Touch never opens it, nor does a trigger outside an open popover
 * (`popoverOpenElsewhere`). `text` may hold several lines (`\n`): the
 * first (or the first `labelLines`) is the label, the rest muted lines. `shortcut` adds a muted
 * key after the label (`Complete Space`). Only labels and shortcuts go in a
 * tooltip, never anything clickable.
 *
 * Returns props for the trigger plus the tooltip node; while open the trigger
 * is `aria-describedby` the tooltip (`role="tooltip"`).
 */
export function useTooltip(text: string | null | undefined, opts: {
  shortcut?: string
  labelLines?: number
  /** A description in sentences (`TooltipBubble`'s `prose`, as Settings' ⓘ shows one): no label line. */
  prose?: boolean
} = {}): UseTooltipResult {
  const id = useId()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])
  const hide = useCallback(function hideTooltip() {
    cancel()
    releaseTooltipSlot(hideTooltip)
    setOpen(false)
  }, [cancel])
  const showSoon = useCallback((el: HTMLElement) => {
    anchorRef.current = el
    cancel()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (popoverOpenElsewhere(el)) return
      takeTooltipSlot(hide)
      setOpen(true)
    }, TOOLTIP_DELAY_MS)
  }, [cancel, hide])

  useEffect(() => () => {
    cancel()
    releaseTooltipSlot(hide)
  }, [cancel, hide])

  if (!text) return { triggerProps: {}, tooltip: null }

  const triggerProps: TooltipTriggerProps = {
    onPointerEnter: (e) => {
      if (e.pointerType === 'touch') return
      showSoon(e.currentTarget)
    },
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (e) => {
      // Keyboard focus only — a click focuses the trigger too.
      let keyboard = true
      try { keyboard = e.currentTarget.matches(':focus-visible') } catch { /* old engines */ }
      if (keyboard) showSoon(e.currentTarget)
    },
    onBlur: hide,
    'aria-describedby': open ? id : undefined,
  }
  return {
    triggerProps,
    // Escape, a scroll or a resize closes it (the bubble's `usePopoverAnchor`).
    tooltip: open ? <TooltipBubble id={id} anchorRef={anchorRef} text={text} shortcut={opts.shortcut} labelLines={opts.labelLines} prose={opts.prose} onClose={hide} /> : null,
  }
}
