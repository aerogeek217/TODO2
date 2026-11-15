import { useEffect, useId, useRef, useState } from 'react'
import { TooltipBubble } from './TooltipBubble'
import { popoverOpenElsewhere, TOOLTIP_DELAY_MS } from './use-tooltip'
import { TOOLTIP_ATTR, TOOLTIP_SHORTCUT_ATTR } from '../../utils/dom-contract'

const SELECTOR = `[${TOOLTIP_ATTR}]`

/** The element with a tooltip at or around `target`, if any. */
function tooltipOwner(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>(SELECTOR)
  return el && el.getAttribute(TOOLTIP_ATTR) ? el : null
}

/** Adds or takes `id` out of the element's `aria-describedby`, leaving its others. */
function describedBy(el: HTMLElement, id: string, on: boolean) {
  const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((t) => t && t !== id)
  if (on) ids.push(id)
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '))
  else el.removeAttribute('aria-describedby')
}

interface Open {
  el: HTMLElement
  text: string
  shortcut?: string
}

/**
 * The one tooltip for every element that names its hover text in
 * `data-tooltip` (flair P9, one tooltip everywhere): mounted once in the
 * shell, it listens on the document and shows the app's `TooltipBubble` as
 * `useTooltip` does — after {@link TOOLTIP_DELAY_MS} of hover or keyboard
 * focus; closed on leave, blur, a press, Escape, a scroll or a resize; never
 * for touch, nor for a trigger outside an open popover; the trigger
 * `aria-describedby` the tooltip while it shows. An element that leaves the
 * page while its tooltip shows takes the tooltip with it.
 */
export function TooltipHost() {
  const id = useId()
  const [open, setOpen] = useState<Open | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let timer: number | null = null
    let pending: HTMLElement | null = null
    const cancel = () => {
      if (timer != null) window.clearTimeout(timer)
      timer = null
      pending = null
    }
    const hide = () => {
      cancel()
      setOpen(null)
    }
    const showSoon = (el: HTMLElement) => {
      if (pending === el) return
      cancel()
      pending = el
      timer = window.setTimeout(() => {
        timer = null
        pending = null
        const text = el.getAttribute(TOOLTIP_ATTR)
        if (!text || !el.isConnected || popoverOpenElsewhere(el)) return
        anchorRef.current = el
        setOpen({ el, text, shortcut: el.getAttribute(TOOLTIP_SHORTCUT_ATTR) ?? undefined })
      }, TOOLTIP_DELAY_MS)
    }
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = tooltipOwner(e.target)
      if (el) showSoon(el)
    }
    const out = (e: PointerEvent) => {
      const el = tooltipOwner(e.target)
      if (!el) return
      // Still inside it (onto one of its children): nothing changes.
      if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return
      hide()
    }
    const focusIn = (e: FocusEvent) => {
      const el = tooltipOwner(e.target)
      if (!el || el !== e.target) return
      // Keyboard focus only — a click focuses the trigger too.
      let keyboard = true
      try { keyboard = el.matches(':focus-visible') } catch { /* old engines */ }
      if (keyboard) showSoon(el)
    }
    const focusOut = (e: FocusEvent) => {
      if (tooltipOwner(e.target)) hide()
    }
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', focusIn, true)
    document.addEventListener('focusout', focusOut, true)
    return () => {
      cancel()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', focusIn, true)
      document.removeEventListener('focusout', focusOut, true)
    }
  }, [])

  // While it shows: the trigger describes itself by it; the trigger leaving
  // the page, or its text going, closes it.
  useEffect(() => {
    if (!open) return
    const { el } = open
    describedBy(el, id, true)
    const watch = new MutationObserver(() => {
      if (!el.isConnected || !el.getAttribute(TOOLTIP_ATTR)) setOpen(null)
    })
    watch.observe(document.body, { childList: true, subtree: true })
    watch.observe(el, { attributes: true, attributeFilter: [TOOLTIP_ATTR] })
    return () => {
      watch.disconnect()
      describedBy(el, id, false)
    }
  }, [open, id])

  if (!open) return null
  return <TooltipBubble id={id} anchorRef={anchorRef} text={open.text} shortcut={open.shortcut} onClose={() => setOpen(null)} />
}
