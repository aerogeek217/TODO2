// Task marker glyphs (16×16 viewBox, currentColor), sized in `em` so they
// follow the surrounding font size. Decorative: the element that shows one
// carries the accessible name. `tooltip` adds a native hover tooltip on the
// SVG (`<title>`), so a row's own `[title]` queries keep finding the title.

import type { MarkerKey } from '../../models'

/** Props shared by every marker glyph. */
interface GlyphProps {
  tooltip?: string
}

const SVG_STYLE = { verticalAlign: '-0.125em', flexShrink: 0 } as const

/** Urgent: a bar and a dot (the red exclamation). */
export function UrgentIcon({ tooltip }: GlyphProps = {}) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      {tooltip && <title>{tooltip}</title>}
      <path d="M8 3v6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="8" cy="12.6" r="1.4" fill="currentColor" />
    </svg>
  )
}

const STAR_PATH = 'M8 1.6l1.95 4.1 4.45.55-3.27 3.08.84 4.42L8 11.6l-3.97 2.15.84-4.42L1.6 6.25l4.45-.55z'

/** Important: a five-point star, filled (or outlined, for an off toggle). */
export function ImportantIcon({ outline = false, tooltip }: GlyphProps & { outline?: boolean } = {}) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      {tooltip && <title>{tooltip}</title>}
      <path
        d={STAR_PATH}
        fill={outline ? 'none' : 'currentColor'}
        stroke={outline ? 'currentColor' : 'none'}
        strokeWidth={outline ? 1.3 : 0}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Focus: a ring with a filled centre dot. */
export function FocusIcon({ tooltip }: GlyphProps = {}) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      {tooltip && <title>{tooltip}</title>}
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
    </svg>
  )
}

/** Urgent by due date: a clock (shown in the Urgent slot instead of the mark). */
export function UrgentClockIcon({ tooltip }: GlyphProps = {}) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      {tooltip && <title>{tooltip}</title>}
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5v3.2l2.1 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The glyph of a marker. */
export function MarkerIcon({ marker }: { marker: MarkerKey }) {
  switch (marker) {
    case 'urgent': return <UrgentIcon />
    case 'important': return <ImportantIcon />
    case 'focus': return <FocusIcon />
  }
}
