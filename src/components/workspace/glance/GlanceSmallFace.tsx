import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import styles from './GlanceWidget.module.css'

/**
 * A glance widget's small face (D25 R): its title and its headline number —
 * with what the number is in a word or two, and the top entry's name for a
 * breakdown (Status, People, Tags). Not interactive: its cell opens the full
 * widget on a click.
 */
export function GlanceSmallFace({ glyph, glyphColor, title, value, valueColor, caption, entry }: {
  glyph: GlanceGlyphName
  glyphColor: string
  title: string
  /** The headline: a count, or a signed net (`+3`). */
  value: string
  /** The headline's colour (lit when it asks for action); the text colour by default. */
  valueColor?: string
  /** What the number counts (`late`, `this week`). */
  caption?: string
  /** A breakdown's top entry (its name, beside the number). */
  entry?: string
}) {
  const words = [title, entry, `${value}${caption ? ` ${caption}` : ''}`].filter(Boolean).join(': ')
  return (
    <div className={styles.smallFace} role="group" aria-label={words} data-testid="glance-small-face">
      <span className={styles.smallTitle}>
        <GlanceGlyph name={glyph} size={12} color={glyphColor} />
        <span className={styles.smallTitleText}>{title}</span>
      </span>
      <span className={styles.smallFigures}>
        {entry && <span className={styles.smallEntry}>{entry}</span>}
        <span className={styles.smallValue} style={valueColor ? { color: valueColor } : undefined} data-testid="glance-small-value">{value}</span>
        {caption && <span className={styles.smallCaption}>{caption}</span>}
      </span>
    </div>
  )
}
