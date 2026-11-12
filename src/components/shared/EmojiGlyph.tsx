import { useId } from 'react'
import styles from './AppIcon.module.css'

interface EmojiGlyphProps {
  emoji: string
  /** Muted (the default, decision 15): one color, `currentColor` or `color`. Else its own colors. */
  muted: boolean
  /** Its size: px, or a CSS length (`1em`: the size of the text around it, as a status glyph is). */
  size: number | string
  color?: string
  className?: string
}

/**
 * An emoji as an icon (`AppIcon`, `StatusMark`). A **muted** one is one
 * color like a line icon: an inline SVG filter turns the glyph's own
 * shading gray and then into its color — `flood-color: currentColor`, read
 * where the filter sits, inside the icon, so it takes whatever color the
 * icon is given or inherits, live (a hover, a tab turning active, a status's
 * color). The filter is referenced by a fragment (`url(#…)`), which fetches
 * nothing — the offline file's egress check and CSP accept it. A
 * text-shadow silhouette was tried and doesn't work: Chromium on Windows
 * draws a color emoji over its shadow.
 */
export function EmojiGlyph({ emoji, muted, size, color, className }: EmojiGlyphProps) {
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
