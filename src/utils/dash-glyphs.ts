/**
 * The dashboard's stroke glyphs (16×16 viewBox, stroke 1.6, round caps and
 * joins, `currentColor`), also the task dialog's header glyph. Decorative:
 * the control that shows one carries the accessible name.
 */
export const DASH_GLYPH = {
  open: 'M2.5 9h3l1 2h3l1-2h3M4 3.5h8l1.5 5.5v4h-11V9z',
  hot: 'M8 14.2c-2.6 0-4.6-1.9-4.6-4.4 0-2.7 2.3-3.9 2.8-6.9 1.8 1 2.8 2.6 2.8 4.1.7-.5 1.1-1.3 1.2-2.1 1.6 1.3 2.4 3.1 2.4 4.9 0 2.5-2 4.4-4.6 4.4z',
  urgent: 'M8 3v6M8 12.4v.4',
  overdue: 'M2.9 8a5.1 5.1 0 1 0 1.5-3.6M2.6 2.6v2.6h2.6M8 5.4V8l1.8 1.2',
  calendar: 'M4.5 3.5h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM2.5 6.5h11M5.5 2v3M10.5 2v3',
  followup: 'M3.5 14V2.5M3.5 3h8l-1.6 2.6 1.6 2.6h-8',
  focus: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zM8 6.8a1.2 1.2 0 1 1 0 2.4a1.2 1.2 0 1 1 0-2.4z',
  chart: 'M2.5 13.5h11M4.5 11V8M7 11V5M9.5 11V7M12 11V3.5',
  status: 'M3.5 13V9.5M8 13V6M12.5 13V3',
  tag: 'M2.5 3.3v4.2l6.3 6.3 5-5-6.3-6.3H3.3a.8.8 0 0 0-.8.8zM5.6 5.6h.1',
  stale: 'M4.5 2.5h7M4.5 13.5h7M5.3 2.5c0 3.1 2.7 3.6 2.7 5.5s-2.7 2.4-2.7 5.5M10.7 2.5c0 3.1-2.7 3.6-2.7 5.5s2.7 2.4 2.7 5.5',
  done: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zM5.6 8.2l1.7 1.7 3.1-3.3',
  matrix: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',
  people: 'M6 7.5a2.3 2.3 0 1 0 0-4.6a2.3 2.3 0 0 0 0 4.6zM2 13c.4-2.3 2-3.6 4-3.6s3.6 1.3 4 3.6M10.6 3.1a2.2 2.2 0 0 1 0 4.2M12 9.6c1.1.5 1.8 1.7 2 3.4',
  list: 'M6.5 4.5h7M6.5 8h7M6.5 11.5h7M3 4.5h.5M3 8h.5M3 11.5h.5',
  none: 'M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zM5 8h6',
  chevron: 'M6 4l4 4-4 4',
  plus: 'M8 3v10M3 8h10',
  sliders: 'M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7M11 3v3M5 10v3',
  copy: 'M6.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5',
} as const

export type DashGlyphName = keyof typeof DASH_GLYPH
