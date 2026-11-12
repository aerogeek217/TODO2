import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { LayoutTab } from '../../models/workspace-layout'
import type { WidgetFaceHost } from '../../hooks/use-widget-face'
import { openWidgetLarger } from '../../services/widget-popup'
import { useUIStore } from '../../stores/ui-store'
import { tabOpensLarger, type WidgetFace } from '../../utils/widget-face'

/**
 * A cell's side of the widget faces (D25 R): the face its active widget
 * reports (`useWidgetFace` through `WidgetFaceContext`), and whether it opens
 * larger — the widget popup (`services/widget-popup`), which a small face's
 * click, its keyboard opener (`CellFaceParts`), the controls slot's Open
 * larger and the ⋯ menu open. Shared by the desktop cell and the phone's, so
 * every widget that picks a face gets them.
 */

/** How the cell measures its widget's face. */
export interface CellFaceOptions {
  /** A fit row: its content sets its height, so it is always the small face. */
  forced?: WidgetFace
  /** The body's height is its content's (`WidgetFaceHost.heightFree`). */
  heightFree?: boolean
}

export interface CellFace {
  /** The face the active widget shows (`large` for a widget that has none, and until it reports). */
  face: WidgetFace
  /** For `WidgetFaceContext` around the active widget. */
  host: WidgetFaceHost
  /** The widget offers Open larger at this face (`tabOpensLarger`: a Number only where its large face adds something). */
  opensLarger: boolean
  /** The widget is open in the popup. */
  open: boolean
  /** Opens it in the popup. */
  openLarger: () => void
}

/**
 * The face of a cell's active tab (`tab`, keyed by its id and kind: a kind
 * change starts over), whether it opens larger at that face, and its opening.
 */
export function useCellFace(tab: LayoutTab | undefined, opts: CellFaceOptions): CellFace {
  const key = tab ? `${tab.id}|${tab.kind}` : null
  const tabId = tab?.id
  const [report, setReport] = useState<{ key: string; face: WidgetFace } | null>(null)
  const onFace = useCallback((face: WidgetFace) => {
    if (key == null) return
    setReport((prev) => (prev?.key === key && prev.face === face ? prev : { key, face }))
  }, [key])
  const openLarger = useCallback(() => {
    if (tabId != null) void openWidgetLarger(tabId)
  }, [tabId])
  const open = useUIStore((s) => tabId != null && s.widgetPopup?.kind === 'tab' && s.widgetPopup.tabId === tabId)
  const face: WidgetFace = opts.forced ?? (report && report.key === key ? report.face : 'large')
  const opensLarger = tab != null && tabOpensLarger(tab, face)
  const { forced, heightFree } = opts
  const host = useMemo<WidgetFaceHost>(
    () => ({ forced, heightFree, onFace, openFull: opensLarger ? openLarger : undefined }),
    [forced, heightFree, onFace, opensLarger, openLarger],
  )
  return { face, host, opensLarger, open, openLarger }
}

/**
 * A cell body's click at the small face: opens the widget in the popup —
 * unless the widget handled the click (`preventDefault`: a Number's own
 * drill) or it doesn't open larger.
 */
export function smallFaceClick(cellFace: Pick<CellFace, 'face' | 'opensLarger' | 'openLarger'>): ((e: MouseEvent) => void) | undefined {
  if (cellFace.face !== 'small' || !cellFace.opensLarger) return undefined
  return (e) => {
    if (e.defaultPrevented) return
    cellFace.openLarger()
  }
}
