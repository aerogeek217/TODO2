import { useLayoutEffect, useState, type RefObject } from 'react'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { drawnSizes } from './divider-drag'

/** The table's tracks as drawn (px), by axis: measured after each render and on a resize. */
export interface DrawnTracks {
  columns: number[]
  rows: number[]
}

/** The table's tracks as drawn (px), measured from `anchor` (the table, or an element in it) after each render and on a resize. */
export function useDrawnTracks(anchor: RefObject<HTMLElement | null>, layout: WorkspaceLayout): DrawnTracks {
  const [drawn, setDrawn] = useState<DrawnTracks>({ columns: [], rows: [] })
  useLayoutEffect(() => {
    const table = anchor.current?.closest<HTMLElement>('[data-ws-table]')
    if (!table) return
    const measure = () => {
      const next = { columns: drawnSizes(table, 'columns'), rows: drawnSizes(table, 'rows') }
      setDrawn((was) => (sameSizes(was.columns, next.columns) && sameSizes(was.rows, next.rows) ? was : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(table)
    return () => observer.disconnect()
  }, [anchor, layout])
  return drawn
}

function sameSizes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.5)
}
