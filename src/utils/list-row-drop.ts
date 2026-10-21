/**
 * Where a row dragged inside a list widget would land, from the widget's
 * geometry as measured when the drag started (so rows making room during the
 * drag don't move the targets under the pointer). Positions are in the
 * scroll container's content coordinates (`clientY - top + scrollTop`).
 */

import { attrSelector, LIST_SECTION_ATTR, ROW_KEY_ATTR, ROW_TODO_ATTR } from './dom-contract'

export interface ListRowGeom {
  key: string
  todoId: number
  /** Vertical midpoint. */
  mid: number
}

export interface ListSectionGeom {
  key: string
  top: number
  bottom: number
  /** Displayed rows, in order (none for a collapsed group). */
  rows: ListRowGeom[]
}

export interface ListGeometry {
  sections: ListSectionGeom[]
}

/** The dragged row: its occurrence key, section and index among the section's displayed rows. */
export interface ListRowDragSource {
  key: string
  todoId: number
  sectionKey: string
  index: number
}

/**
 * The landing spot: before row `index` of the section's displayed rows
 * without the dragged one (`index` = row count → at the end). `cross` when
 * the section is another group than the row's own.
 */
export interface ListRowDropTarget {
  sectionKey: string
  index: number
  cross: boolean
}

/**
 * The drop target at content-y `y`, or `null` when there is none: no
 * sections, or another group while `canCross` is off (date groups don't take
 * rows from each other).
 */
export function listRowDropTarget(
  geom: ListGeometry,
  y: number,
  source: ListRowDragSource,
  canCross: boolean,
): ListRowDropTarget | null {
  const { sections } = geom
  if (sections.length === 0) return null
  // The section under the pointer; in a gap between groups (or past the
  // ends), the next one down, else the last.
  const section = sections.find((s) => y < s.bottom) ?? sections[sections.length - 1]
  if (!section) return null
  const cross = section.key !== source.sectionKey
  if (cross && !canCross) return null
  let index = 0
  for (const row of section.rows) {
    if (row.key === source.key) continue
    if (row.mid < y) index++
  }
  return { sectionKey: section.key, index, cross }
}

/** Reads a list widget's geometry from the DOM (`data-list-section` blocks, `data-row-key` rows). */
export function measureListGeometry(scrollEl: HTMLElement): ListGeometry {
  const origin = scrollEl.getBoundingClientRect().top - scrollEl.scrollTop
  const sections = Array.from(scrollEl.querySelectorAll(attrSelector(LIST_SECTION_ATTR))).map((el): ListSectionGeom => {
    const r = el.getBoundingClientRect()
    return {
      key: el.getAttribute(LIST_SECTION_ATTR) ?? '',
      top: r.top - origin,
      bottom: r.bottom - origin,
      rows: Array.from(el.querySelectorAll(attrSelector(ROW_KEY_ATTR))).map((row) => {
        const rr = row.getBoundingClientRect()
        return { key: row.getAttribute(ROW_KEY_ATTR) ?? '', todoId: Number(row.getAttribute(ROW_TODO_ATTR)), mid: (rr.top + rr.bottom) / 2 - origin }
      }),
    }
  })
  return { sections }
}

/** The content-y of a viewport `clientY` in `scrollEl`. */
export function contentY(scrollEl: HTMLElement, clientY: number): number {
  return clientY - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
}
