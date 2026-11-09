/**
 * A squarified treemap (Bruls, Huizing & van Wijk): `values` (positive,
 * largest first for the best shapes) laid out in `rect`, each a rectangle
 * whose area is its share of the whole, as close to square as the rows
 * allow. Pure; the rectangles come back in `values`' order.
 */

export interface TreemapRect {
  x: number
  y: number
  w: number
  h: number
}

/** The worst aspect ratio of a row of `areas` laid along a side of `side`. */
function worst(areas: readonly number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0)
  if (sum <= 0 || side <= 0) return Number.POSITIVE_INFINITY
  const max = Math.max(...areas)
  const min = Math.min(...areas)
  const s2 = side * side
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min))
}

export function squarify(values: readonly number[], rect: TreemapRect): TreemapRect[] {
  const total = values.reduce((a, b) => a + Math.max(0, b), 0)
  const out: TreemapRect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }))
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out
  const scale = (rect.w * rect.h) / total
  const areas = values.map((v) => Math.max(0, v) * scale)
  let { x, y, w, h } = rect
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row: number[] = []
    let j = i
    // Grow the row while it doesn't make the worst ratio worse.
    while (j < areas.length) {
      const next = [...row, areas[j] ?? 0]
      if (row.length > 0 && worst(next, side) > worst(row, side)) break
      row.push(areas[j] ?? 0)
      j++
    }
    const sum = row.reduce((a, b) => a + b, 0)
    if (w >= h) {
      // A column along the left side.
      const colW = h > 0 ? sum / h : 0
      let yy = y
      for (let k = 0; k < row.length; k++) {
        const hh = colW > 0 ? (row[k] ?? 0) / colW : 0
        out[i + k] = { x, y: yy, w: colW, h: hh }
        yy += hh
      }
      x += colW
      w -= colW
    } else {
      // A row along the top.
      const rowH = w > 0 ? sum / w : 0
      let xx = x
      for (let k = 0; k < row.length; k++) {
        const ww = rowH > 0 ? (row[k] ?? 0) / rowH : 0
        out[i + k] = { x: xx, y, w: ww, h: rowH }
        xx += ww
      }
      y += rowH
      h -= rowH
    }
    i = j
  }
  return out
}
