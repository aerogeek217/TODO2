import { useId } from 'react'
import type { IconValue } from '../../models/icon'
import { LineIcon } from './icons'
import styles from './AppIcon.module.css'

interface AppIconProps {
  /** The icon to draw; `none` draws nothing. */
  icon: IconValue
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
 * Draws a picked icon (items 11, 14; `models/icon`): a built-in line icon, an
 * emoji, or nothing for `none`. Decorative (`aria-hidden`): the control that
 * holds it carries the words.
 *
 * A **muted** emoji (the default, decision 15) is one color like a line
 * icon: an inline SVG filter turns the glyph's own shading gray and then
 * into its color — `flood-color: currentColor`, read where the filter sits,
 * inside the icon, so it takes whatever color the icon is given or
 * inherits, live (a hover, a tab turning active). The filter is referenced
 * by a fragment (`url(#…)`), which fetches nothing — the offline file's
 * egress check and CSP accept it. A text-shadow silhouette was tried and
 * doesn't work: Chromium on Windows draws a color emoji over its shadow.
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
  return <EmojiGlyph emoji={icon.emoji} muted={icon.show !== 'color'} size={size} color={color} className={className} />
}

function EmojiGlyph({ emoji, muted, size, color, className }: { emoji: string; muted: boolean; size: number; color?: string; className?: string }) {
  // A fragment id CSS reads unescaped: `useId`'s own characters dropped.
  const id = `app-icon-tint-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <span
      className={[styles.icon, styles.emoji, className ?? ''].join(' ')}
      style={{ fontSize: size, width: size, height: size, ...(color ? { color } : {}) }}
      data-app-icon={muted ? 'emoji-muted' : 'emoji-color'}
      aria-hidden="true"
    >
      {muted && (
        <svg className={styles.defs} width="0" height="0" focusable="false">
          <filter id={id} colorInterpolationFilters="sRGB">
            {/* The glyph's luminance, in all three channels (its alpha kept). */}
            <feColorMatrix
              type="matrix"
              values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
              result="gray"
            />
            <feFlood className={styles.tint} result="tint" />
            {/* The tint at 60 % to 120 % by the luminance: the emoji's own shading, in one color. */}
            <feComposite in="tint" in2="gray" operator="arithmetic" k1="0.6" k2="0.6" k3="0" k4="0" result="shaded" />
            <feComposite in="shaded" in2="SourceAlpha" operator="in" />
          </filter>
        </svg>
      )}
      <span className={styles.glyph} style={muted ? { filter: `url(#${id})` } : undefined}>{emoji}</span>
    </span>
  )
}
