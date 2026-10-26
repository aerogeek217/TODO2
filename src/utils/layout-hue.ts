import { isHueName, type HueName } from '../models/workspace-layout'
import { isValidCssColor } from './css'

/** Each preset hue's colour (its theme token pair, `tokens.css`). */
const HUE_COLOR: Readonly<Record<HueName, string>> = {
  teal: 'var(--hue-teal)',
  violet: 'var(--hue-violet)',
  blue: 'var(--hue-blue)',
  green: 'var(--hue-green)',
  amber: 'var(--hue-amber)',
  rose: 'var(--hue-rose)',
}

/**
 * A layout's hue as stored (`WorkspaceLayout.hue`): a preset's name
 * (`HUE_NAMES`, each a token pair with a light twin) or a hex colour the
 * user picked in the Edit layout dialog's colour input (`#rgb` / `#rrggbb`,
 * used as it is in both themes).
 */
export function isLayoutHue(v: unknown): v is string {
  return isHueName(v) || isValidCssColor(v)
}

/** A layout hue as CSS: a preset's token, a custom colour itself; none = the app accent. */
export function hueColor(hue: string | null | undefined): string {
  if (!hue) return 'var(--color-accent)'
  return isHueName(hue) ? HUE_COLOR[hue] : hue.toLowerCase()
}

/** The hue for `data-layout-hue`: a preset's name, `custom` for a colour, `none` without one. */
export function hueAttr(hue: string | null | undefined): string {
  if (!hue) return 'none'
  return isHueName(hue) ? hue : 'custom'
}

/** A preset hue's name in words (the Edit layout dialog's swatches). */
export const HUE_LABEL: Readonly<Record<HueName, string>> = {
  teal: 'Teal',
  violet: 'Violet',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  rose: 'Rose',
}
