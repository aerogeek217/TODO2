import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { TooltipBubble } from '../components/shared/TooltipBubble'

/** How long the pointer (or keyboard focus) rests on a trigger before its tooltip opens. */
export const TOOLTIP_DELAY_MS = 400

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
 * scroll. Touch never opens it. `text` may hold several lines (`\n`): the
 * first is the label, the rest a muted second line. `shortcut` adds a muted
 * key after the label (`Complete Space`). Only labels and shortcuts go in a
 * tooltip, never anything clickable.
 *
 * Returns props for the trigger plus the tooltip node; while open the trigger
 * is `aria-describedby` the tooltip (`role="tooltip"`).
 */
export function useTooltip(text: string | null | undefined, opts: { shortcut?: string } = {}): UseTooltipResult {
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
  const hide = useCallback(() => {
    cancel()
    setOpen(false)
  }, [cancel])
  const showSoon = useCallback((el: HTMLElement) => {
    anchorRef.current = el
    cancel()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setOpen(true)
    }, TOOLTIP_DELAY_MS)
  }, [cancel])

  useEffect(() => cancel, [cancel])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [open, hide])

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
    tooltip: open ? <TooltipBubble id={id} anchorRef={anchorRef} text={text} shortcut={opts.shortcut} /> : null,
  }
}
