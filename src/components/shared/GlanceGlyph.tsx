import type { CSSProperties } from 'react'
import { GLANCE_GLYPH, type GlanceGlyphName } from '../../utils/glance-glyphs'

/** A glance glyph (decorative: the control that shows it carries the name). */
export function GlanceGlyph({ name, size = 14, color, strokeWidth = 1.6, className }: {
  name: GlanceGlyphName
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
}) {
  const style: CSSProperties | undefined = color ? { color } : undefined
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: 'none', ...style }}
    >
      <path d={GLANCE_GLYPH[name]} />
    </svg>
  )
}
