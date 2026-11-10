import { numberIsLit, type NumberConfig } from '../../../models/glance-widgets'
import { themeColor } from '../../../utils/theme-color'

/** A lit Number on Auto takes the accent. */
const AUTO_COLOR = 'var(--color-accent)'

/** A Number's (or a group item's) colours. */
export interface NumberColors {
  lit: boolean
  label: string
  count: string
}

/**
 * A Number's colours at `count` (D18): lit (`numberIsLit`), its label and
 * count take its colour (Auto: the accent); else they stay neutral — the
 * label muted, the count in the text colour, a 0 muted.
 */
export function numberColors(config: Pick<NumberConfig, 'color' | 'litWhen' | 'litAt'>, count: number): NumberColors {
  return litColors(config.color, numberIsLit(config, count), count === 0)
}

/**
 * The colours of a figure that is `lit` or not (a shape's own rule: a goal
 * behind its pace, D26 P6): lit, its `color` as the theme draws it
 * (`themeColor`, J21; Auto: the accent); else the label muted and the figure
 * in the text colour (`muted`: a 0, muted too).
 */
export function litColors(color: string | undefined, lit: boolean, muted = false): NumberColors {
  if (lit) {
    const c = color ? themeColor(color) : AUTO_COLOR
    return { lit: true, label: c, count: c }
  }
  const mutedColor = 'var(--color-text-muted)'
  return { lit: false, label: mutedColor, count: muted ? mutedColor : 'var(--color-text-primary)' }
}
