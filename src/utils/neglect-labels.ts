/**
 * Where the Neglect map writes a task's name beside its dot: only where the
 * name fits without covering a dot, a badge, another name or one of the
 * plot's own words. Pure — the widget gives the dots as drawn (px in their
 * field) and each name's measured width.
 */

/** A name's line: its height, px. */
export const NEGLECT_LABEL_HEIGHT_PX = 13
/** Between a dot (or its badge) and its name, px. */
export const NEGLECT_LABEL_GAP_PX = 4
/** A name is cut (an ellipsis) past this width, px. */
export const NEGLECT_LABEL_MAX_PX = 160
/** Less room than this shows no name: a stub of a few letters says nothing. */
export const NEGLECT_LABEL_MIN_PX = 56

/** A box in the field's px. */
export interface LabelRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** A dot as drawn. */
export interface LabelDot {
  id: number
  /** Its centre, px in the field. */
  x: number
  y: number
  /** Half its drawn size, its ring included. */
  radius: number
  /** Its name's whole width, px. */
  textWidth: number
  /** Its badge, drawn above it on that side: the name starts past it there. */
  badge?: { side: 'right' | 'left'; width: number; height: number }
}

/** A name's place: beside its dot on `side`, `offset` px from the dot's centre, `width` px wide (narrower than its text: cut). */
export interface PlacedLabel {
  id: number
  side: 'right' | 'left'
  offset: number
  width: number
}

interface Owned extends LabelRect {
  /** The dot it belongs to (its own box and badge never block its name). */
  owner?: number
}

function badgeRect(d: LabelDot): Owned | null {
  if (!d.badge) return null
  // As drawn: 2px off the dot's box, its bottom 2px under the box's top.
  const bottom = d.y - d.radius + 2
  const left = d.badge.side === 'right' ? d.x + d.radius + 2 : d.x - d.radius - 2 - d.badge.width
  return { left, right: left + d.badge.width, top: bottom - d.badge.height, bottom, owner: d.id }
}

/**
 * The names that fit, for `dots` in the order given — earlier dots get their
 * names first, so pass the ones that matter most first. A name goes to the
 * right of its dot, else to its left: whole where it fits (up to
 * `NEGLECT_LABEL_MAX_PX`), else cut to the room there is when that is at
 * least `NEGLECT_LABEL_MIN_PX`, else not at all. Nothing is placed in a
 * field that hasn't been measured (`width` or `height` 0).
 */
export function placeNeglectLabels(
  dots: readonly LabelDot[],
  field: { width: number; height: number },
  obstacles: readonly LabelRect[] = [],
): Map<number, PlacedLabel> {
  const placed = new Map<number, PlacedLabel>()
  if (field.width <= 0 || field.height <= 0) return placed
  const taken: Owned[] = [...obstacles]
  for (const d of dots) {
    taken.push({ left: d.x - d.radius, right: d.x + d.radius, top: d.y - d.radius, bottom: d.y + d.radius, owner: d.id })
    const badge = badgeRect(d)
    if (badge) taken.push(badge)
  }
  const half = NEGLECT_LABEL_HEIGHT_PX / 2
  for (const d of dots) {
    if (d.textWidth <= 0) continue
    const want = Math.min(d.textWidth, NEGLECT_LABEL_MAX_PX)
    const top = d.y - half
    const bottom = d.y + half
    /** The room beside the dot on `side`: where the name starts (px from the centre) and how wide it may be. */
    const room = (side: 'right' | 'left'): { offset: number; width: number } => {
      const past = d.badge?.side === side ? 2 + d.badge.width : 0
      const offset = d.radius + past + NEGLECT_LABEL_GAP_PX
      const start = side === 'right' ? d.x + offset : d.x - offset
      let end = side === 'right' ? field.width : 0
      for (const r of taken) {
        if (r.owner === d.id || r.bottom <= top || r.top >= bottom) continue
        if (side === 'right') { if (r.right > start) end = Math.min(end, r.left) } else if (r.left < start) end = Math.max(end, r.right)
      }
      return { offset, width: Math.max(0, side === 'right' ? end - start : start - end) }
    }
    const right = room('right')
    const left = room('left')
    const fit = right.width >= want ? { side: 'right' as const, ...right, width: want }
      : left.width >= want ? { side: 'left' as const, ...left, width: want }
        : right.width >= NEGLECT_LABEL_MIN_PX && right.width >= left.width ? { side: 'right' as const, ...right }
          : left.width >= NEGLECT_LABEL_MIN_PX ? { side: 'left' as const, ...left }
            : right.width >= NEGLECT_LABEL_MIN_PX ? { side: 'right' as const, ...right } : null
    if (!fit) continue
    placed.set(d.id, { id: d.id, side: fit.side, offset: fit.offset, width: fit.width })
    const start = fit.side === 'right' ? d.x + fit.offset : d.x - fit.offset - fit.width
    taken.push({ left: start, right: start + fit.width, top, bottom, owner: d.id })
  }
  return placed
}
