import { registerModuleReset } from '../../utils/module-reset'

/** The tags cell's font: the meta size in the app font. */
const TAG_FONT_SIZE = 12
/** Average glyph width, as a share of the font size, where text can't be measured (no canvas). */
const FALLBACK_CHAR_EM = 6.5 / 12

const cache = new Map<string, number>()
let context: OffscreenCanvasRenderingContext2D | null | undefined
let family: string | null = null

registerModuleReset(() => {
  cache.clear()
  context = undefined
  family = null
})

function measureContext(): OffscreenCanvasRenderingContext2D | null {
  if (context === undefined) {
    context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d')
  }
  return context
}

function appFont(sizePx: number, weight: number): string {
  if (family === null) {
    family = getComputedStyle(document.documentElement).getPropertyValue('--font-family').trim() || 'sans-serif'
  }
  return `${weight} ${sizePx}px ${family}`
}

// Widths measured before the web font loaded are off: measure again once it has.
if (typeof document !== 'undefined' && 'fonts' in document) {
  document.fonts.addEventListener('loadingdone', () => cache.clear())
}

/**
 * The width of `text` in the app font at `sizePx` (and `weight`), px —
 * measured once per text (cached), never per row or per dot. Estimated where
 * the browser can't measure.
 */
export function appTextWidth(text: string, sizePx: number, weight = 400): number {
  const key = `${sizePx}|${weight}|${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const ctx = measureContext()
  let width: number
  if (ctx) {
    ctx.font = appFont(sizePx, weight)
    width = Math.ceil(ctx.measureText(text).width)
  } else {
    width = Math.ceil(text.length * sizePx * FALLBACK_CHAR_EM)
  }
  cache.set(key, width)
  return width
}

/** The width of `text` in the tags cell's font, px. */
export function tagTextWidth(text: string): number {
  return appTextWidth(text, TAG_FONT_SIZE)
}
