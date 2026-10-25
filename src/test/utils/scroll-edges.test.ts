import { describe, it, expect } from 'vitest'
import { CAN_SCROLL_DOWN_ATTR, CAN_SCROLL_UP_ATTR, scrollEdges, trackScrollEdges } from '../../utils/scroll-edges'

function scroller(scrollTop: number, clientHeight: number, scrollHeight: number): HTMLDivElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop })
  return el
}

describe('scrollEdges', () => {
  it('a body that fits scrolls neither way', () => {
    expect(scrollEdges({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 })).toEqual({ up: false, down: false })
  })

  it('at the top only down; at the bottom only up; between both', () => {
    expect(scrollEdges({ scrollTop: 0, clientHeight: 200, scrollHeight: 500 })).toEqual({ up: false, down: true })
    expect(scrollEdges({ scrollTop: 300, clientHeight: 200, scrollHeight: 500 })).toEqual({ up: true, down: false })
    expect(scrollEdges({ scrollTop: 120, clientHeight: 200, scrollHeight: 500 })).toEqual({ up: true, down: true })
  })

  it('a sub-pixel remainder at either end does not count', () => {
    expect(scrollEdges({ scrollTop: 0.5, clientHeight: 200, scrollHeight: 200.8 })).toEqual({ up: false, down: false })
  })
})

describe('trackScrollEdges', () => {
  it('flags the body on attach and clears the flags on cleanup', () => {
    const el = scroller(40, 200, 500)
    const stop = trackScrollEdges(el)
    expect(el.hasAttribute(CAN_SCROLL_UP_ATTR)).toBe(true)
    expect(el.hasAttribute(CAN_SCROLL_DOWN_ATTR)).toBe(true)
    stop?.()
    expect(el.hasAttribute(CAN_SCROLL_UP_ATTR)).toBe(false)
    expect(el.hasAttribute(CAN_SCROLL_DOWN_ATTR)).toBe(false)
  })

  it('never flags a body that does not scroll', () => {
    const el = scroller(0, 200, 120)
    const stop = trackScrollEdges(el)
    expect(el.hasAttribute(CAN_SCROLL_UP_ATTR)).toBe(false)
    expect(el.hasAttribute(CAN_SCROLL_DOWN_ATTR)).toBe(false)
    stop?.()
  })

  it('a detached ref is a no-op', () => {
    expect(trackScrollEdges(null)).toBeUndefined()
  })
})
