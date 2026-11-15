import { afterEach, describe, expect, it } from 'vitest'
import { CELL_HOT_ATTR, trackCellHot } from '../../components/workspace/cell-hot'
import { trackHot } from '../../utils/hot-attr'

/**
 * `trackHot` (cr34 H5): an attribute kept in step with an element's own
 * `:hover` / `:focus-within` from their events — a cell's `data-cell-hot`,
 * which its hover-only controls show by, and a list's `data-rows-hover`. The
 * real pseudo-classes, and what a pointer crossing costs, are
 * `e2e/cell-hot.spec.ts`'s.
 */

let stop: (() => void) | undefined

function cell(): { el: HTMLElement; inside: HTMLButtonElement; other: HTMLButtonElement; outside: HTMLButtonElement } {
  document.body.innerHTML = ''
  const el = document.createElement('section')
  const inside = document.createElement('button')
  const other = document.createElement('button')
  el.append(inside, other)
  const outside = document.createElement('button')
  document.body.append(el, outside)
  return { el, inside, other, outside }
}

const hot = (el: HTMLElement) => el.hasAttribute(CELL_HOT_ATTR)
const microtask = () => Promise.resolve()

afterEach(() => {
  stop?.()
  stop = undefined
  document.body.innerHTML = ''
})

describe('trackHot (a cell: hover and focus)', () => {
  it('marks the cell while the pointer is over it', () => {
    const { el } = cell()
    stop = trackCellHot(el)
    expect(hot(el)).toBe(false)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(hot(el)).toBe(true)
    el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(hot(el)).toBe(false)
  })

  it('marks the cell while the focus is in it, across a move inside it, until the focus leaves', async () => {
    const { el, inside, other, outside } = cell()
    stop = trackCellHot(el)
    inside.focus()
    expect(hot(el)).toBe(true)
    other.focus()
    await microtask()
    expect(hot(el)).toBe(true)
    outside.focus()
    await microtask()
    expect(hot(el)).toBe(false)
  })

  it('stays marked by the focus after the pointer leaves, and by the pointer after the focus leaves', async () => {
    const { el, inside, outside } = cell()
    stop = trackCellHot(el)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    inside.focus()
    el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(hot(el)).toBe(true)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    outside.focus()
    await microtask()
    expect(hot(el)).toBe(true)
    el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(hot(el)).toBe(false)
  })

  it('a cell that already holds the focus when it is tracked starts marked', () => {
    const { el, inside } = cell()
    inside.focus()
    stop = trackCellHot(el)
    expect(hot(el)).toBe(true)
  })

  it('the focused element removed from the cell (no event says so) clears the mark', async () => {
    const { el, inside } = cell()
    stop = trackCellHot(el)
    inside.focus()
    expect(hot(el)).toBe(true)
    inside.remove()
    // The removal is seen by a MutationObserver: its callback runs as a microtask.
    await microtask()
    await microtask()
    expect(document.activeElement).toBe(document.body)
    expect(hot(el)).toBe(false)
  })

  it('its cleanup takes the mark and the listeners away', () => {
    const { el, inside } = cell()
    const off = trackCellHot(el)
    inside.focus()
    expect(hot(el)).toBe(true)
    off?.()
    expect(hot(el)).toBe(false)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(hot(el)).toBe(false)
  })

  it('no element: nothing to track', () => {
    expect(trackCellHot(null)).toBeUndefined()
  })
})

describe('trackHot (hover only)', () => {
  it('follows the pointer and ignores the focus', () => {
    const { el, inside } = cell()
    stop = trackHot(el, 'data-rows-hover', { hover: true })
    inside.focus()
    expect(el.hasAttribute('data-rows-hover')).toBe(false)
    el.dispatchEvent(new MouseEvent('mouseenter'))
    expect(el.hasAttribute('data-rows-hover')).toBe(true)
    el.dispatchEvent(new MouseEvent('mouseleave'))
    expect(el.hasAttribute('data-rows-hover')).toBe(false)
  })
})
