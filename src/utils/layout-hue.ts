import { HUE_NAMES, isHueName, type HueName } from '../models/workspace-layout'
import { isValidCssColor } from './css'

/**
 * Each preset hue's colour in the dark theme (`--hue-<name>` there): what
 * the preset swatches of every colour picker insert (a person's, status's
 * or tag's colour is one hex, theme-agnostic). `src/test/styles` pins them
 * to `tokens.css`.
 */
export const HUE_PRESET_HEX: Readonly<Record<HueName, string>> = {
  teal: '#7ec4bc',
  violet: '#a78bfa',
  blue: '#5b8def',
  green: '#4fb286',
  amber: '#e9a23b',
  rose: '#e07a9a',
}

/** The preset hue whose colour `hex` is (case-insensitive), or `null`. */
export function presetHueOf(hex: string | null | undefined): HueName | null {
  if (!hex) return null
  const h = hex.toLowerCase()
  return HUE_NAMES.find((n) => HUE_PRESET_HEX[n] === h) ?? null
}

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
