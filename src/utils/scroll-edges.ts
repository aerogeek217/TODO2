/**
 * Scroll-edge fades (D19): a scrolling body carries `data-can-scroll-up` /
 * `data-can-scroll-down` while it has more content that way, and the global
 * stylesheet fades that edge (`tokens.css`). A body that doesn't scroll gets
 * neither, so it is never faded.
 */

export const CAN_SCROLL_UP_ATTR = 'data-can-scroll-up'
export const CAN_SCROLL_DOWN_ATTR = 'data-can-scroll-down'

/** More than this many pixels left that way counts (sub-pixel rounding at the ends doesn't). */
const SLACK_PX = 1

/** Which ways a scroller can still scroll. */
export function scrollEdges(el: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>): { up: boolean; down: boolean } {
  return {
    up: el.scrollTop > SLACK_PX,
    down: el.scrollTop + el.clientHeight < el.scrollHeight - SLACK_PX,
  }
}

function setFlag(el: HTMLElement, attr: string, on: boolean): void {
  if (on) el.setAttribute(attr, '')
  else el.removeAttribute(attr)
}

/**
 * A ref callback (React 19: it returns its cleanup) that keeps a scroller's
 * edge flags current: on scroll, and when it or its content resizes (a
 * `ResizeObserver` on it and on each child, re-taken as children change).
 * Module-level, so its identity is stable and it attaches once.
 */
export function trackScrollEdges(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined
  let frame = 0
  const update = (): void => {
    frame = 0
    const { up, down } = scrollEdges(el)
    setFlag(el, CAN_SCROLL_UP_ATTR, up)
    setFlag(el, CAN_SCROLL_DOWN_ATTR, down)
  }
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update)
  }
  el.addEventListener('scroll', schedule, { passive: true })
  const resize = new ResizeObserver(schedule)
  const observeChildren = (): void => {
    resize.disconnect()
    resize.observe(el)
    for (const child of el.children) resize.observe(child)
  }
  observeChildren()
  const children = new MutationObserver(() => {
    observeChildren()
    schedule()
  })
  children.observe(el, { childList: true })
  update()
  return () => {
    if (frame) cancelAnimationFrame(frame)
    el.removeEventListener('scroll', schedule)
    resize.disconnect()
    children.disconnect()
    el.removeAttribute(CAN_SCROLL_UP_ATTR)
    el.removeAttribute(CAN_SCROLL_DOWN_ATTR)
  }
}
