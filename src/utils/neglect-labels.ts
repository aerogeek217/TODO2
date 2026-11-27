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
 * The boxes in the way, bucketed by where they are (cr34 G9 / S6): a grid of
 * `CELL_W` × `CELL_H` px cells, each box listed in every cell it touches. A
 * name looks only at the cells its own strip crosses, so placing every name
 * costs the dots near each one, not every dot for every dot.
 */
const CELL_W = 64
const CELL_H = 16

/**
 * The most box tests one placement makes. A map of a few thousand tasks
 * stays far under it; past it — tens of thousands of dots piled on a few
 * spots — the names not yet tried are left out, the ones that matter most
 * (the first in the order given) having been tried first. It bounds the
 * time a huge or hand-made file can take on each resize.
 */
export const NEGLECT_LABEL_WORK_MAX = 2_000_000

class BoxGrid {
  private readonly cols: number
  private readonly rows: number
  private readonly cells = new Map<number, Owned[]>()
  /** Box tests made so far (`NEGLECT_LABEL_WORK_MAX`). */
  work = 0

  constructor(field: { width: number; height: number }) {
    this.cols = Math.max(1, Math.ceil(field.width / CELL_W))
    this.rows = Math.max(1, Math.ceil(field.height / CELL_H))
  }

  /** A coordinate's cell along an axis of `n` cells `size` px each; one off the field counts in the edge cell. */
  private at(v: number, size: number, n: number): number {
    return Math.min(n - 1, Math.max(0, Math.floor(v / size)))
  }

  add(r: Owned): void {
    const c1 = this.at(r.right, CELL_W, this.cols)
    const r1 = this.at(r.bottom, CELL_H, this.rows)
    for (let row = this.at(r.top, CELL_H, this.rows); row <= r1; row++) {
      for (let col = this.at(r.left, CELL_W, this.cols); col <= c1; col++) {
        const key = row * this.cols + col
        const cell = this.cells.get(key)
        if (cell) cell.push(r)
        else this.cells.set(key, [r])
      }
    }
  }

  /**
   * The room for a name of dot `owner` in the strip `top` … `bottom`, from
   * `start` towards `side`, `reach` px at most (the most the name takes, or
   * the px to the field's edge: room past that changes nothing): the px
   * before the nearest box in the way, a box across `start` leaving none.
   * Under `floor` px it is 0 — too little for a name, so the look stops there.
   */
  room(owner: number, side: 'right' | 'left', start: number, reach: number, top: number, bottom: number, floor: number): number {
    let width = reach
    if (width < floor) return 0
    const c0 = this.at(side === 'right' ? start : start - reach, CELL_W, this.cols)
    const c1 = this.at(side === 'right' ? start + reach : start, CELL_W, this.cols)
    const r1 = this.at(bottom, CELL_H, this.rows)
    for (let row = this.at(top, CELL_H, this.rows); row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = this.cells.get(row * this.cols + col)
        if (!cell) continue
        for (const r of cell) {
          this.work += 1
          if (r.owner === owner || r.bottom <= top || r.top >= bottom) continue
          if (side === 'right') {
            if (r.right > start && r.left - start < width) width = r.left - start
          } else if (r.left < start && start - r.right < width) width = start - r.right
          if (width < floor) return 0
        }
      }
    }
    return width
  }
}

/**
 * The names that fit, for `dots` in the order given — earlier dots get their
 * names first, so pass the ones that matter most first. A name goes to the
 * right of its dot, else to its left: whole where it fits (up to
 * `NEGLECT_LABEL_MAX_PX`), else cut to the room there is when that is at
 * least `NEGLECT_LABEL_MIN_PX`, else not at all. Nothing is placed in a
 * field that hasn't been measured (`width` or `height` 0). The work is
 * bounded (`BoxGrid`): a name looks only at the boxes near it, and once
 * `workMax` box tests are made (`NEGLECT_LABEL_WORK_MAX`) no further name
 * is tried.
 */
export function placeNeglectLabels(
  dots: readonly LabelDot[],
  field: { width: number; height: number },
  obstacles: readonly LabelRect[] = [],
  workMax: number = NEGLECT_LABEL_WORK_MAX,
): Map<number, PlacedLabel> {
  const placed = new Map<number, PlacedLabel>()
  if (field.width <= 0 || field.height <= 0) return placed
  const taken = new BoxGrid(field)
  for (const o of obstacles) taken.add(o)
  for (const d of dots) {
    taken.add({ left: d.x - d.radius, right: d.x + d.radius, top: d.y - d.radius, bottom: d.y + d.radius, owner: d.id })
    const badge = badgeRect(d)
    if (badge) taken.add(badge)
  }
  const half = NEGLECT_LABEL_HEIGHT_PX / 2
  for (const d of dots) {
    if (d.textWidth <= 0) continue
    if (taken.work >= workMax) break
    const want = Math.min(d.textWidth, NEGLECT_LABEL_MAX_PX)
    const top = d.y - half
    const bottom = d.y + half
    /**
     * The room beside the dot on `side`: where the name starts (px from the
     * centre) and how wide it may be — never more than the name takes, and 0
     * where there is less than a name needs (`NEGLECT_LABEL_MIN_PX`).
     */
    const room = (side: 'right' | 'left'): { offset: number; width: number } => {
      const past = d.badge?.side === side ? 2 + d.badge.width : 0
      const offset = d.radius + past + NEGLECT_LABEL_GAP_PX
      const start = side === 'right' ? d.x + offset : d.x - offset
      const reach = Math.min(want, side === 'right' ? field.width - start : start)
      return { offset, width: taken.room(d.id, side, start, reach, top, bottom, Math.min(want, NEGLECT_LABEL_MIN_PX)) }
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
    taken.add({ left: start, right: start + fit.width, top, bottom, owner: d.id })
  }
  return placed
}

/** An axis mark's label along its axis, px in the axis: where it starts and ends. */
interface AxisMarkSpan {
  key: string
  start: number
  end: number
}

/** Under this many px between two axis marks' labels, the one that may give way does. */
const NEGLECT_MARK_MIN_GAP_PX = 4

/**
 * The axis marks to draw: all of them, but the `optional` one (the y axis's
 * `+Nd`, the x axis's `30d`) gives way when its label comes within
 * `NEGLECT_MARK_MIN_GAP_PX` of a neighbour's, or overlaps it.
 */
export function uncrowdedMarks<T extends AxisMarkSpan>(marks: readonly T[], optional: string): T[] {
  const sorted = [...marks].sort((a, b) => a.start - b.start)
  const i = sorted.findIndex((m) => m.key === optional)
  const mark = sorted.at(i)
  if (i < 0 || !mark) return [...marks]
  const prev = i > 0 ? sorted.at(i - 1) : undefined
  const next = sorted.at(i + 1)
  const crowded = (prev != null && mark.start - prev.end < NEGLECT_MARK_MIN_GAP_PX)
    || (next != null && next.start - mark.end < NEGLECT_MARK_MIN_GAP_PX)
  return crowded ? marks.filter((m) => m.key !== optional) : [...marks]
}
