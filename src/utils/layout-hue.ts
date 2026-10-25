import type { HueName } from '../models/workspace-layout'

/** Each layout hue's colour (its theme token pair, `tokens.css`). */
const HUE_COLOR: Readonly<Record<HueName, string>> = {
  teal: 'var(--hue-teal)',
  violet: 'var(--hue-violet)',
  blue: 'var(--hue-blue)',
  green: 'var(--hue-green)',
  amber: 'var(--hue-amber)',
  rose: 'var(--hue-rose)',
}

/** A layout hue as CSS; none = the app accent. */
export function hueColor(hue: HueName | null | undefined): string {
  return hue ? HUE_COLOR[hue] : 'var(--color-accent)'
}

/** A hue's name in words (the Rename dialog's swatches). */
export const HUE_LABEL: Readonly<Record<HueName, string>> = {
  teal: 'Teal',
  violet: 'Violet',
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  rose: 'Rose',
}
