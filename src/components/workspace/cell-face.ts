import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'
import type { WidgetFaceHost } from '../../hooks/use-widget-face'
import type { WidgetFace } from '../../utils/widget-face'

/**
 * A cell's side of the widget faces (D25 R): the face its active widget
 * reports (`useWidgetFace` through `WidgetFaceContext`), and the click that
 * opens a small face's full widget (`CellFaceParts`: its keyboard opener and
 * its popover). Shared by the desktop cell and the phone's, so every widget
 * that picks a face gets them.
 */

/** The cell header's height (`--cell-header-height`): what a cell headless only for its small face lends its body. */
export const CELL_HEADER_PX = 32

/** How the cell measures its widget's face. */
export interface CellFaceOptions {
  /** A fit row: its content sets its height, so it is always the small face. */
  forced?: WidgetFace
  /**
   * Px the body gains while the face is small: the header's room, for a
   * cell headless only for its small face (`WidgetFaceHost.heightAllowancePx`).
   */
  smallAllowancePx?: number
  /** The body's height is its content's (`WidgetFaceHost.heightFree`). */
  heightFree?: boolean
}

export interface CellFace {
  /** The face the active widget shows (`large` for a widget that has none, and until it reports). */
  face: WidgetFace
  /** For `WidgetFaceContext` around the active widget. */
  host: WidgetFaceHost
  /** The full widget is open over the cell. */
  fullOpen: boolean
  openFull: () => void
  closeFull: () => void
}

/**
 * The face of a cell's active tab (`tab`, keyed by its id and kind: a kind
 * change starts over) and its full-widget popover, open while the face isn't
 * `large` (a cell grown to large closes it; so does another active tab).
 */
export function useCellFace(tab: LayoutTab | undefined, opts: CellFaceOptions): CellFace {
  const key = tab ? `${tab.id}|${tab.kind}` : null
  const [report, setReport] = useState<{ key: string; face: WidgetFace } | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const onFace = useCallback((face: WidgetFace) => {
    if (key == null) return
    setReport((prev) => (prev?.key === key && prev.face === face ? prev : { key, face }))
  }, [key])
  const openFull = useCallback(() => setOpenKey(key), [key])
  const closeFull = useCallback(() => setOpenKey(null), [])
  const face: WidgetFace = opts.forced ?? (report && report.key === key ? report.face : 'large')
  const fullOpen = openKey != null && openKey === key && face !== 'large'
  // Closed for good once the face grows to large or another tab is active (not back when it shrinks again).
  if (openKey != null && !fullOpen) setOpenKey(null)
  const { forced, heightFree } = opts
  const heightAllowancePx = face === 'small' ? opts.smallAllowancePx : undefined
  const host = useMemo<WidgetFaceHost>(
    () => ({ forced, heightAllowancePx, heightFree, onFace, openFull }),
    [forced, heightAllowancePx, heightFree, onFace, openFull],
  )
  return { face, host, fullOpen, openFull, closeFull }
}

/**
 * A cell body's click at the small face: opens the full widget, or closes
 * it again — unless the widget handled the click (`preventDefault`: a
 * Number's own drill).
 */
export function smallFaceClick(cellFace: Pick<CellFace, 'face' | 'fullOpen' | 'openFull' | 'closeFull'>): ((e: MouseEvent) => void) | undefined {
  if (cellFace.face !== 'small') return undefined
  return (e) => {
    if (e.defaultPrevented) return
    if (cellFace.fullOpen) cellFace.closeFull()
    else cellFace.openFull()
  }
}
