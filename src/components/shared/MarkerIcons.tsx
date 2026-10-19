// Task marker glyphs (16×16 viewBox, currentColor), sized in `em` so they
// follow the surrounding font size. Decorative: the element that shows one
// carries the accessible name and the tooltip (`TaskMarkers`).

import type { MarkerKey } from '../../models'

const SVG_STYLE = { verticalAlign: '-0.125em', flexShrink: 0 } as const

/** Urgent: a bar and a dot (the red exclamation). */
export function UrgentIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      <path d="M8 3v6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="8" cy="12.6" r="1.4" fill="currentColor" />
    </svg>
  )
}

const STAR_PATH = 'M8 1.6l1.95 4.1 4.45.55-3.27 3.08.84 4.42L8 11.6l-3.97 2.15.84-4.42L1.6 6.25l4.45-.55z'

/** Important: a five-point star, filled (or outlined, for an off toggle). */
export function ImportantIcon({ outline = false }: { outline?: boolean } = {}) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
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
export function FocusIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
    </svg>
  )
}

/** A clock: a due date (the task row's dates cell), and urgent by due date. */
export function ClockIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5v3.2l2.1 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Urgent by due date: the clock, shown in the Urgent slot instead of the mark. */
export const UrgentClockIcon = ClockIcon

/** Hot (derived from the markers by the Settings rule): a flame. */
export function HotIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" style={SVG_STYLE} aria-hidden>
      <path
        d="M8 14.2c-2.6 0-4.6-1.9-4.6-4.4 0-2.7 2.3-3.9 2.8-6.9 1.8 1 2.8 2.6 2.8 4.1.7-.5 1.1-1.3 1.2-2.1 1.6 1.3 2.4 3.1 2.4 4.9 0 2.5-2 4.4-4.6 4.4z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
