import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getActiveTab, type LayoutCell, type WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { runPlaceWords, sliverRun, trackNames } from '../../utils/layout-rulers'
import { PlusIcon } from '../shared/icons'
import { drawnSizes } from './divider-drag'
import { GUTTER_PLUS_ATTR, type GutterHover } from './gutter-plus'
import { insertPreview, showStructurePreview } from './insert-preview'
import { useTabTitles } from './widget-hooks'
import styles from './GutterPlus.module.css'

/**
 * A "+" along every gutter in the layout edit mode (layout editor round
 * two, concept A): hovering a divider shows a "+" just beside its line that
 * follows the pointer along it (the divider itself stays free to drag); hovered, the table draws the full row / column it would
 * insert there (`insert-preview`), the "+" staying where it is while the
 * table reflows; a click inserts it — on a sliver's run, the run's line, as
 * the rulers' "+" does. The divider's drag still resizes.
 */

/** Half the "+"'s length along its line: it stays this far inside the divider's ends. */
const HALF_PX = 14
/** Its near edge this far from the line, across it: right of a column line, below a row line, clear of the divider. */
const BESIDE_PX = 5

export function GutterPlus({ hover, layout, onKeep, onDone }: {
  hover: GutterHover
  layout: WorkspaceLayout
  /** The pointer reached it: it stays (the divider's leave hides it only a moment later). */
  onKeep: () => void
  onDone: () => void
}) {
  const [previewing, setPreviewing] = useState(false)
  /** The run it inserts on, read as the pointer arrives (the table then draws the preview, not the draft). */
  const planned = useRef<{ first: number; last: number } | null>(null)
  // Gone while its preview shows: the preview goes with it.
  useEffect(() => (previewing ? () => showStructurePreview(null) : undefined), [previewing])
  const tabs = useMemo(() => layout.cells.flatMap((c) => c.tabs), [layout.cells])
  const titles = useTabTitles(tabs)
  const cellName = useCallback((cell: LayoutCell) => {
    const tab = getActiveTab(cell)
    const i = tab ? tabs.indexOf(tab) : -1
    return i >= 0 ? (titles[i] ?? 'A widget') : 'An empty slot'
  }, [tabs, titles])
  const { axis, line } = hover
  const noun = axis === 'columns' ? 'column' : 'row'
  /** The run of lines it inserts on (a sliver's two as one) and its place in words, from the table as drawn. */
  const run = () => {
    const table = document.querySelector<HTMLElement>('[data-ws-table]')
    const sizes = table ? drawnSizes(table, axis) : []
    const [first, last] = sliverRun(layout, axis, line, sizes)
    return { first, last, where: runPlaceWords(trackNames(layout, axis, sizes), first, last, noun) }
  }
  const end = () => {
    if (previewing) showStructurePreview(null)
    setPreviewing(false)
  }
  // Along the line at the pointer, kept inside the divider; just beside the line across (so the divider stays free to drag).
  const along = Math.min(Math.max(axis === 'columns' ? hover.y : hover.x, hover.from + HALF_PX), hover.to - HALF_PX)
  const style = axis === 'columns' ? { left: hover.x + BESIDE_PX, top: along } : { left: along, top: hover.y + BESIDE_PX }
  // Portaled to the page: fixed over the table, not one of its grid items.
  return createPortal(
    <button
      type="button"
      className={styles.plus}
      data-axis={axis}
      data-hot={previewing ? '' : undefined}
      {...{ [GUTTER_PLUS_ATTR]: '' }}
      style={style}
      aria-label={`Insert ${noun} here`}
      // A move onto it (not an enter: appearing under a resting pointer previews nothing), not while a button is held.
      onMouseMove={(e) => {
        onKeep()
        if (e.buttons !== 0 || previewing) return
        const { first, last, where } = run()
        planned.current = { first, last }
        const preview = insertPreview(layout, axis, first, last, where, cellName)
        if (!preview) return
        setPreviewing(true)
        showStructurePreview(preview)
      }}
      onMouseLeave={() => {
        end()
        onDone()
      }}
      onClick={() => {
        const { first, last } = planned.current ?? run()
        end()
        onDone()
        const store = useWorkspaceStore.getState()
        if (store.editing?.incoming && store.placeIncoming({ kind: 'line', axis, index: first, through: last })) return
        const cellId = store.insertTrackAt(axis, first, undefined, last)
        if (cellId) store.selectEditCell(cellId)
      }}
    >
      <PlusIcon size={12} strokeWidth={2.2} />
      <span className={styles.noun}>{axis === 'columns' ? 'Column' : 'Row'}</span>
    </button>,
    document.body,
  )
}
