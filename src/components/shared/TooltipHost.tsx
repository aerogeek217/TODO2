import { useEffect, useId, useRef, useState } from 'react'
import { TooltipBubble } from './TooltipBubble'
import { popoverOpenElsewhere, releaseTooltipSlot, takeTooltipSlot, TOOLTIP_DELAY_MS } from './use-tooltip'
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

/** What an element's tooltip says now. */
function openFor(el: HTMLElement, text: string): Open {
  return { el, text, shortcut: el.getAttribute(TOOLTIP_SHORTCUT_ATTR) ?? undefined }
}

/**
 * The one tooltip for every element that names its hover text in
 * `data-tooltip` (flair P9, one tooltip everywhere): mounted once in the
 * shell, it listens on the document and shows the app's `TooltipBubble` as
 * `useTooltip` does — after {@link TOOLTIP_DELAY_MS} of hover or keyboard
 * focus; closed on leave, blur, a press, Escape, a scroll or a resize; never
 * for touch, nor for a trigger outside an open popover; the trigger
 * `aria-describedby` the tooltip while it shows. It shares `useTooltip`'s
 * one slot (`takeTooltipSlot`): opening either closes the other. While it
 * shows, the trigger's text changing changes it, and the trigger leaving
 * the page (or its text going) closes it; moving among the trigger's own
 * children leaves it as it is.
 */
export function TooltipHost() {
  const id = useId()
  const [open, setOpen] = useState<Open | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  /** Closes it from outside the listeners' effect (the bubble's Escape / scroll, the trigger leaving). */
  const hideRef = useRef<() => void>(() => {})

  useEffect(() => {
    let timer: number | null = null
    let pending: HTMLElement | null = null
    let shown: HTMLElement | null = null
    const cancel = () => {
      if (timer != null) window.clearTimeout(timer)
      timer = null
      pending = null
    }
    const hide = () => {
      cancel()
      shown = null
      releaseTooltipSlot(hide)
      setOpen(null)
    }
    hideRef.current = hide
    const showSoon = (el: HTMLElement) => {
      // Already showing or about to (the pointer moving among its children).
      if (pending === el || shown === el) return
      cancel()
      pending = el
      timer = window.setTimeout(() => {
        timer = null
        pending = null
        const text = el.getAttribute(TOOLTIP_ATTR)
        if (!text || !el.isConnected || popoverOpenElsewhere(el)) return
        takeTooltipSlot(hide)
        shown = el
        anchorRef.current = el
        setOpen(openFor(el, text))
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
      releaseTooltipSlot(hide)
      hideRef.current = () => {}
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', focusIn, true)
      document.removeEventListener('focusout', focusOut, true)
    }
  }, [])

  // While it shows: the trigger describes itself by it; its text changing
  // changes it; the trigger leaving the page, or its text going, closes it.
  const el = open?.el ?? null
  useEffect(() => {
    if (!el) return
    describedBy(el, id, true)
    const watch = new MutationObserver(() => {
      const text = el.getAttribute(TOOLTIP_ATTR)
      if (!el.isConnected || !text) {
        hideRef.current()
        return
      }
      const now = openFor(el, text)
      setOpen((o) => (o && o.el === el && (o.text !== now.text || o.shortcut !== now.shortcut) ? now : o))
    })
    watch.observe(document.body, { childList: true, subtree: true })
    watch.observe(el, { attributes: true, attributeFilter: [TOOLTIP_ATTR, TOOLTIP_SHORTCUT_ATTR] })
    return () => {
      watch.disconnect()
      describedBy(el, id, false)
    }
  }, [el, id])

  if (!open) return null
  return <TooltipBubble id={id} anchorRef={anchorRef} text={open.text} shortcut={open.shortcut} onClose={() => hideRef.current()} />
}
