import type { HueName } from '../models/workspace-layout'
import { presetHueOf } from './layout-hue'

/**
 * A stored colour drawn as text in either theme (J21; no schema step). A
 * Number's or a count column's colour is one hex, picked in the dark theme
 * (the swatches insert the dark hues, `HUE_PRESET_HEX`), so drawn as it is it
 * fails contrast on the light surfaces. What to draw instead, as CSS:
 *
 * - a preset hue's hex → that hue's text token (`--hue-<name>-text`: the hue
 *   itself in dark, a darker twin in light);
 * - one of the four colours the v78 upgrade wrote for the old metrics (the
 *   dark theme's danger, overdue, follow-up and muted text at v77,
 *   `upgrades/v78/number-metrics`) → that meaning's token, which has a light twin;
 * - any other colour → itself mixed with `--custom-color-shade` of black in
 *   oklab: 0% in dark (the colour as picked), a fixed share in light — no
 *   contrast clamp, so a very light pick may still read faintly there.
 *
 * Nothing stored changes, and the colour pickers keep comparing the hex.
 */

/** Each preset hue's text token (written out: `tokens-in-use` finds them here). */
const HUE_TEXT: Readonly<Record<HueName, string>> = {
  teal: 'var(--hue-teal-text)',
  violet: 'var(--hue-violet-text)',
  blue: 'var(--hue-blue-text)',
  green: 'var(--hue-green-text)',
  amber: 'var(--hue-amber-text)',
  rose: 'var(--hue-rose-text)',
}

/**
 * The colours v78 wrote for the old Number metrics (and the Breakdown's
 * default Due / Follow-up columns), each the dark token's value then → that token.
 */
export const UPGRADE_COLOR_TOKENS: Readonly<Record<string, string>> = {
  '#ee7d77': 'var(--color-danger-text)',
  '#e86bf0': 'var(--color-overdue)',
  '#f5c842': 'var(--color-followup)',
  '#8f8a83': 'var(--color-text-muted)',
}

/** `color` (a stored colour, usually a hex) as the CSS to draw it as text in the current theme. */
export function themeColor(color: string): string {
  const c = color.trim().toLowerCase()
  const hue = presetHueOf(c)
  if (hue) return HUE_TEXT[hue]
  return UPGRADE_COLOR_TOKENS[c] ?? `color-mix(in oklab, ${c}, #000 var(--custom-color-shade))`
}
