import type { CSSProperties } from 'react'
import { MARKER_COLOR, priorityRing, type MarkerSummary } from '../../utils/markers'
import type { MarkerKey } from '../../models'
import styles from './PriorityRing.module.css'

/** The ring's stroke, px: drawn 1px in from the box's edge, so its outer edge is the box's. */
const STROKE = 2
/** The ring's centre-line radius, px: `--radius-checkbox` (5px) less half the stroke. */
const RADIUS = 4
/** Urgent only by its due date: a fine dash, px (finer than `border: dashed` can draw). */
const DASH = 2
const GAP = 1.5
/**
 * Focus's glow around the box, as shares of its side: the blur (4px at a
 * row's 18px box, 2.5px at a Lines box's 11px) and the spread (1px / 0.5px)
 * — tight, so it reads as the box's own light, not a haze over its row.
 */
const GLOW_BLUR = 0.22
const GLOW_SPREAD = 0.05
const half = (n: number) => Math.round(n * 2) / 2

/** The fills under a lone Urgent / Important ring (about 10% / 8% of its colour). */
const FILL: Partial<Record<MarkerKey, string>> = {
  urgent: 'var(--color-marker-urgent-fill)',
  important: 'var(--color-marker-important-fill)',
}

/** A dashed part's `pathLength`: a whole number of dash periods, so the dashes meet evenly where the path closes. */
function dashedLength(length: number): number {
  return Math.max(1, Math.round(length / (DASH + GAP))) * (DASH + GAP)
}

/**
 * A task's priority drawn on its checkbox (D25 B), the same at every zoom:
 * Urgent and Important as an SVG ring over the box, `size` px square — one
 * 2px ring in the marker's colour with a faint fill, or Urgent + Important
 * as a split ring (top-right urgent, bottom-left important); urgent only by
 * its due date finely dashed —, and Focus as a tight glow in the Focus
 * colour around the box (`[data-focus-glow]`), never an outline: with a
 * ring, or around the box's own plain border. Nothing for no priority or a
 * completed task (the checked box as it is) — only, with a `label`, an
 * empty element that carries the name. Decorative unless `label` names it —
 * the desktop row's marker gutter carries the name.
 */
export function PriorityRing({ summary, completed, size, corner, label }: {
  summary: Pick<MarkerSummary, 'focus' | 'urgent' | 'important'>
  completed: boolean
  /** The box's side, px. */
  size: number
  /** The box's corner radius, px, where it isn't a checkbox's or a Lines box's (a List wall square's 2px). */
  corner?: number
  /** The ring's accessible name (the phone row's: it has no gutter); absent = hidden from assistive tech. */
  label?: string
}) {
  const ring = priorityRing(summary, completed)
  const named = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  // Nothing to draw (no priority, a completed task): a named ring still says it — `No priority`, or a completed task's own.
  if (ring.kind === 'none' && !ring.focusGlow) return label ? <span className={styles.name} {...named} data-priority-name="" /> : null
  const glow = ring.focusGlow && (
    <span
      className={styles.glow}
      style={{
        // The box's corner: a row's checkbox 5px, a Lines box 4px.
        borderRadius: corner ?? (size >= 16 ? RADIUS + STROKE / 2 : RADIUS),
        boxShadow: `0 0 ${half(size * GLOW_BLUR)}px ${half(size * GLOW_SPREAD)}px var(--color-marker-focus-glow)`,
      }}
      data-focus-glow=""
      // Named here when there is no ring to carry the name.
      {...(ring.kind === 'none' ? named : { 'aria-hidden': true })}
    />
  )
  if (ring.kind === 'none') return glow
  const lo = STROKE / 2
  const hi = size - STROKE / 2
  const side = hi - lo
  // The ring's centre line follows the box's corner: a given one less half the stroke.
  const r = corner != null ? Math.max(0, corner - STROKE / 2) : RADIUS
  const perimeter = 4 * (side - 2 * r) + 2 * Math.PI * r
  const part = (marker: MarkerKey, fill: boolean, dashed: boolean, length: number): {
    style: CSSProperties
    pathLength?: number
    strokeDasharray?: string
    'data-ring-part': MarkerKey
    'data-dashed'?: ''
  } => ({
    style: { stroke: MARKER_COLOR[marker], fill: fill ? (FILL[marker] ?? 'none') : 'none' },
    ...(dashed ? { pathLength: dashedLength(length), strokeDasharray: `${DASH} ${GAP}`, 'data-dashed': '' as const } : {}),
    'data-ring-part': marker,
  })

  let body
  if (ring.kind === 'split') {
    // Split where a CSS border would: through the top-left and bottom-right corners' 45° points.
    const k = r * (1 - Math.SQRT1_2)
    const arc = `A${r} ${r} 0 0 1`
    const urgent = `M${lo + k} ${lo + k} ${arc} ${lo + r} ${lo} H${hi - r} ${arc} ${hi} ${lo + r} V${hi - r} ${arc} ${hi - k} ${hi - k}`
    const important = `M${hi - k} ${hi - k} ${arc} ${hi - r} ${hi} H${lo + r} ${arc} ${lo} ${hi - r} V${lo + r} ${arc} ${lo + k} ${lo + k}`
    body = (
      <>
        <path d={urgent} {...part('urgent', false, ring.urgentDashed, perimeter / 2)} />
        <path d={important} {...part('important', false, false, perimeter / 2)} />
      </>
    )
  } else {
    const marker: MarkerKey = ring.kind
    const dashed = marker === 'urgent' && ring.urgentDashed
    body = <rect x={lo} y={lo} width={side} height={side} rx={r} {...part(marker, !dashed, dashed, perimeter)} />
  }

  return (
    <>
      {glow}
      <svg
        className={styles.ring}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        strokeWidth={STROKE}
        data-priority-ring={ring.kind}
        {...named}
        focusable="false"
      >
        {body}
      </svg>
    </>
  )
}
