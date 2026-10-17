import { registerModuleReset } from '../../utils/module-reset'

/** The tags cell's font: the meta size in the app font. */
const TAG_FONT_SIZE = 12
/** Average glyph width at 12px where text can't be measured (no canvas). */
const FALLBACK_CHAR_WIDTH = 6.5

const cache = new Map<string, number>()
let context: OffscreenCanvasRenderingContext2D | null | undefined
let font: string | null = null

registerModuleReset(() => {
  cache.clear()
  context = undefined
  font = null
})

function measureContext(): OffscreenCanvasRenderingContext2D | null {
  if (context === undefined) {
    context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  }
  return context
}

function tagFont(): string {
  if (font === null) {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim() || 'sans-serif'
    font = `${TAG_FONT_SIZE}px ${family}`
  }
  return font
}

// Widths measured before the web font loaded are off: measure again once it has.
if (typeof document !== 'undefined' && 'fonts' in document) {
  document.fonts.addEventListener('loadingdone', () => cache.clear())
}

/**
 * The width of `text` in the tags cell's font, px — measured once per text
 * (cached), never per row. Estimated where the browser can't measure.
 */
export function tagTextWidth(text: string): number {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const ctx = measureContext()
  let width: number
  if (ctx) {
    ctx.font = tagFont()
    width = Math.ceil(ctx.measureText(text).width)
  } else {
    width = Math.ceil(text.length * FALLBACK_CHAR_WIDTH)
  }
  cache.set(text, width)
  return width
}
