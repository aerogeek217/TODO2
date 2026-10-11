import type { PopoverPoint } from '../../../stores/list-widget-store'

/** The bottom-left (`start`) or bottom-right (`end`) corner of an element, 4px below. */
export function pointBelow(el: Element, align: PopoverPoint['align'] = 'start'): PopoverPoint {
  const r = el.getBoundingClientRect()
  return { x: align === 'start' ? r.left : r.right, y: r.bottom + 4, align }
}
