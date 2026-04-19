/**
 * jsdom doesn't compute layout, so `getBoundingClientRect()` returns zeros.
 * Tests exercising dnd-kit collision detection need real rects; this
 * utility patches `HTMLElement.prototype.getBoundingClientRect` to read from
 * a resolver function supplied at install time. That resolver is called with
 * each element and returns a rect (or `null` to fall through to the default
 * zero rect).
 *
 * Elements carry identity via data-attributes (e.g. `data-drop-id`,
 * `data-slot-id`, `data-rail-side`). The resolver uses those to pick the
 * correct rect, so rects are available the moment an element mounts — no
 * post-mount `dataset.testRect` coordination needed.
 */

interface TestRect {
  left: number
  top: number
  width: number
  height: number
}

export type RectResolver = (el: HTMLElement) => TestRect | null

const ZERO_RECT: DOMRect = makeRect({ left: 0, top: 0, width: 0, height: 0 })

function makeRect({ left, top, width, height }: TestRect): DOMRect {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, left: this.left, right: this.right, bottom: this.bottom }
    },
  }
  return rect as DOMRect
}

let originalGetBoundingClientRect: (() => DOMRect) | null = null
let currentResolver: RectResolver | null = null

export function installBoundingRectMock(resolver: RectResolver): () => void {
  currentResolver = resolver
  if (originalGetBoundingClientRect !== null) {
    // Update the resolver for nested installs but share the single patch.
    return () => { currentResolver = null }
  }
  originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const el = this as HTMLElement
    // Explicit per-element override via dataset.testRect trumps the resolver.
    const raw = el.dataset?.testRect
    if (raw) {
      try { return makeRect(JSON.parse(raw) as TestRect) } catch { /* fall through */ }
    }
    if (currentResolver) {
      const r = currentResolver(el)
      if (r) return makeRect(r)
    }
    return ZERO_RECT
  }
  return () => {
    if (originalGetBoundingClientRect) {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
      originalGetBoundingClientRect = null
    }
    currentResolver = null
  }
}

export function setTestRect(el: HTMLElement, rect: TestRect): void {
  el.dataset.testRect = JSON.stringify(rect)
}
