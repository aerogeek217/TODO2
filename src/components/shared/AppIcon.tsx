import type { DrawnIcon } from '../../models/icon'
import { EmojiGlyph } from './EmojiGlyph'
import { LineIcon } from './icons'
import { StatusIcon } from './StatusIcon'
import styles from './AppIcon.module.css'

interface AppIconProps {
  /** The icon to draw; `none` draws nothing. */
  icon: DrawnIcon
  /** Its size, px (a line icon's box, an emoji's font size). Default 14. */
  size?: number
  /**
   * The color it takes — a line icon's stroke, a muted emoji's tint. Default:
   * the color around it (`currentColor`), so it follows the text it sits in
   * (gray at rest, the accent on an active tab, a layout's hue). A color
   * emoji keeps its own colors whatever is given.
   */
  color?: string
  className?: string
}

/**
 * Draws a picked icon (items 11, 14; `models/icon`): a built-in line icon, a
 * status glyph (J17, the status editor's picker), an emoji (`EmojiGlyph`:
 * muted, one color, by default), or nothing for `none`. Decorative
 * (`aria-hidden`): the control that holds it carries the words.
 */
export function AppIcon({ icon, size = 14, color, className }: AppIconProps) {
  if (icon.kind === 'none') return null
  const style = color ? { color } : undefined
  if (icon.kind === 'line') {
    return (
      <span className={[styles.icon, className ?? ''].join(' ')} style={style} data-app-icon="line" aria-hidden="true">
        <LineIcon name={icon.key} size={size} />
      </span>
    )
  }
  if (icon.kind === 'status') {
    return (
      <span className={[styles.icon, className ?? ''].join(' ')} style={{ fontSize: size, ...style }} data-app-icon="status" aria-hidden="true">
        <StatusIcon icon={icon.key} />
      </span>
    )
  }
  return <EmojiGlyph emoji={icon.emoji} muted={icon.show !== 'color'} size={size} color={color} className={className} />
}
