import type { PopoverPoint } from '../../../stores/list-widget-store'

/**
 * The bottom-left (`start`) or bottom-right (`end`) corner of an element, 4px
 * below, with the element's rect (a popover anchors to it and points its
 * caret at it — `anchorAtPoint`).
 */
export function pointBelow(el: Element, align: PopoverPoint['align'] = 'start'): PopoverPoint {
  const r = el.getBoundingClientRect()
  return {
    x: align === 'start' ? r.left : r.right,
    y: r.bottom + 4,
    align,
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
  }
}
