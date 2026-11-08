import { numberIsLit, type NumberConfig } from '../../../models/glance-widgets'

/** A lit Number on Auto takes the accent. */
const AUTO_COLOR = 'var(--color-accent)'

/**
 * A Number's colours at `count` (D18): lit (`numberIsLit`), its label and
 * count take its colour (Auto: the accent); else they stay neutral — the
 * label muted, the count in the text colour, a 0 muted.
 */
export function numberColors(config: Pick<NumberConfig, 'color' | 'litWhen' | 'litAt'>, count: number): { lit: boolean; label: string; count: string } {
  if (numberIsLit(config, count)) {
    const color = config.color ?? AUTO_COLOR
    return { lit: true, label: color, count: color }
  }
  const muted = 'var(--color-text-muted)'
  return { lit: false, label: muted, count: count === 0 ? muted : 'var(--color-text-primary)' }
}
