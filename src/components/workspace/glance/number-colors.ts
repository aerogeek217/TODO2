import { numberIsLit, type NumberConfig } from '../../../models/glance-widgets'
import { themeColor } from '../../../utils/theme-color'

/** A lit Number on Auto takes the accent; so does its line on Auto, lit or not. */
const AUTO_COLOR = 'var(--color-accent)'
const MUTED = 'var(--color-text-muted)'

/** A Number's (or a group item's) colours. */
export interface NumberColors {
  lit: boolean
  label: string
  count: string
  /** Its 14-day line (`Sparkline`), where it has one. */
  line: string
}

/** The two colours a Number may be given (widget feedback 2D): lit, and otherwise. */
export type NumberColorPicks = Pick<NumberConfig, 'color' | 'unlitColor'>

/**
 * A Number's colours at `count` (D18): lit (`numberIsLit`) or not, by
 * `litColors`; a 0 is muted.
 */
export function numberColors(config: NumberColorPicks & Pick<NumberConfig, 'litWhen' | 'litAt'>, count: number): NumberColors {
  return litColors(config, numberIsLit(config, count), count === 0)
}

/**
 * A picked colour dimmed as a muted 0 reads beside its count (a 0 drawn in
 * the colour the user picked, still visibly theirs).
 */
export function dimmed(color: string): string {
  return `color-mix(in srgb, ${color} 60%, transparent)`
}

/**
 * The colours of a figure that is `lit` or not (a shape's own rule: a goal
 * behind its pace, D26 P6), each picked colour drawn as the theme draws it
 * (`themeColor`, J21):
 * - lit: its label, figure and line in `color` (Auto: the accent);
 * - otherwise, with `unlitColor` picked: the label, figure and line in it
 *   (a `muted` figure — a 0 — dimmed, `dimmed`);
 * - otherwise on Auto, as before 2D: the label muted, the figure in the text
 *   colour (`muted`: muted too), the line in the accent.
 */
export function litColors(picks: NumberColorPicks, lit: boolean, muted = false): NumberColors {
  if (lit) {
    const c = picks.color ? themeColor(picks.color) : AUTO_COLOR
    return { lit: true, label: c, count: c, line: c }
  }
  if (picks.unlitColor) {
    const c = themeColor(picks.unlitColor)
    return { lit: false, label: c, count: muted ? dimmed(c) : c, line: c }
  }
  return { lit: false, label: MUTED, count: muted ? MUTED : 'var(--color-text-primary)', line: AUTO_COLOR }
}
