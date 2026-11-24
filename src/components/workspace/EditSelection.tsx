import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { getActiveTab, type GridAxis, type LayoutCell, type WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore, type StructurePreview } from '../../stores/workspace-store'
import { mergeButtonWords, mergeChoices, MERGE_ARROW } from '../../utils/layout-edit-cards'
import { runPlaceWords, sliverRun, trackNames } from '../../utils/layout-rulers'
import { spanOf, type Side } from '../../utils/workspace-grid'
import { drawnGap, drawnSizes } from './divider-drag'
import { focusEditItem } from './edit-focus'
import { insertPreview, mergePreview, showStructurePreview } from './insert-preview'
import { useTabTitles } from './widget-hooks'
import { useWorkspaceDrag } from './workspace-drag'
import { useLatestRef } from '../../hooks/use-latest-ref'
import styles from './EditSelection.module.css'

/**
 * The layout edit mode's controls around the selected card or slot: four
 * worded **edge tabs** in the seams at the middle of its edges (`+ Row
 * above`, `+ Row below`, `+ Column left`, `+ Column right`), each a full
 * track on that edge's line (a sliver beside it and its lines one line, as
 * the headers' Insert does: `sliverRun`), sized from the selection's own
 * track; and on each neighbour a card makes a rectangle with
 * (`layout-edit-cards.mergeChoices`), a **merge button** worded from the
 * selection's side with an arrow towards the neighbour (`↑ Merge as tabs
 * with Tasks`; short in a narrow neighbour). Hovered, each draws its edit
 * (`structurePreview`) and the mode bar says it; clicked, it makes it — an
 * insert selects its first new cell, a merge keeps the card selected.
 *
 * They are drawn in the table by its own coordinates, placed from the
 * table as the draft draws it and frozen while a preview reflows it, so
 * the one under the pointer stays there (the others fade). The table puts
 * them right after the selected card, so they follow it in the Tab order.
 * Gone while something is dragged.
 */

/** A box in the table's own coordinates (px from its padding box's corner, its scroll counted). */
interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** The selection's place as drawn: its box, its neighbours', where the room ends, the gap and the tracks. */
interface Placed {
  cellId: string
  card: Box
  others: Readonly<Record<string, Box>>
  right: number
  bottom: number
  gap: number
  sizes: Readonly<Record<GridAxis, number[]>>
}

const EDGE_WORDS: Readonly<Record<Side, string>> = { top: 'Row above', bottom: 'Row below', left: 'Column left', right: 'Column right' }
/** Half an edge tab's thickness and a margin (px): how near the room's end its middle may come. */
const TAB_CLEAR_PX = 12
/** A neighbour narrower than this (px) shows a merge button's short words. */
const SHORT_BELOW_PX = 230

export function EditSelection({ layout, tableRef }: { layout: WorkspaceLayout; tableRef: RefObject<HTMLDivElement | null> }) {
  const selectedId = useWorkspaceStore((s) => s.editing?.selectedCellId ?? null)
  const drag = useWorkspaceDrag()
  const cell = selectedId != null ? layout.cells.find((c) => c.id === selectedId) : undefined
  if (!cell || drag) return null
  return <Controls key={cell.id} cell={cell} layout={layout} tableRef={tableRef} />
}

/** A box of `el` in `table`'s coordinates. */
function boxIn(table: HTMLElement, el: Element): Box {
  const t = table.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  return {
    left: r.left - t.left - table.clientLeft + table.scrollLeft,
    top: r.top - t.top - table.clientTop + table.scrollTop,
    width: r.width,
    height: r.height,
  }
}

function Controls({ cell, layout, tableRef }: { cell: LayoutCell; layout: WorkspaceLayout; tableRef: RefObject<HTMLDivElement | null> }) {
  const previewing = useWorkspaceStore((s) => s.structurePreview != null)
  const [placed, setPlaced] = useState<Placed | null>(null)
  /** The control drawing its edit (its key): the preview goes when it does. */
  const [hot, setHot] = useState<string | null>(null)
  const hotRef = useLatestRef(hot)
  useEffect(() => () => { if (hotRef.current != null) showStructurePreview(null) }, [hotRef])

  // Placed from the table as the draft draws it — not while a preview reflows it.
  useLayoutEffect(() => {
    if (previewing) return
    const table = tableRef.current
    if (!table) return
    const place = () => {
      if (useWorkspaceStore.getState().structurePreview != null) return
      const el = table.querySelector(`[data-ws-cell="${CSS.escape(cell.id)}"]`)
      if (!el) return
      const others: Record<string, Box> = {}
      let right = 0
      let bottom = 0
      for (const c of table.querySelectorAll<HTMLElement>('[data-ws-cell]')) {
        const b = boxIn(table, c)
        others[c.dataset.wsCell ?? ''] = b
        right = Math.max(right, b.left + b.width)
        bottom = Math.max(bottom, b.top + b.height)
      }
      const style = getComputedStyle(table)
      setPlaced({
        cellId: cell.id,
        card: boxIn(table, el),
        others,
        right: right + (Number.parseFloat(style.paddingRight) || 0),
        bottom: bottom + (Number.parseFloat(style.paddingBottom) || 0),
        gap: drawnGap(table, 'columns'),
        sizes: { columns: drawnSizes(table, 'columns'), rows: drawnSizes(table, 'rows') },
      })
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(place)
    observer.observe(table)
    return () => observer.disconnect()
  }, [cell, layout, tableRef, previewing])

  // A resize moves the table under the control drawing its edit: the preview ends.
  useEffect(() => {
    if (hot == null) return
    const end = () => setHot(null)
    window.addEventListener('resize', end)
    return () => window.removeEventListener('resize', end)
  }, [hot])

  const tabs = useMemo(() => layout.cells.flatMap((c) => c.tabs), [layout.cells])
  const titles = useTabTitles(tabs)
  const cellName = useCallback((c: LayoutCell) => {
    const tab = getActiveTab(c)
    const i = tab ? tabs.indexOf(tab) : -1
    return i >= 0 ? (titles[i] ?? 'A widget') : 'An empty slot'
  }, [tabs, titles])

  if (!placed || placed.cellId !== cell.id) return null
  const store = useWorkspaceStore.getState

  /** Starts drawing `key`'s edit — on a move onto it, not an enter (a control appearing under a resting pointer draws nothing), and not while a button is held. */
  const draw = (key: string, make: () => StructurePreview | null) => (e: React.MouseEvent) => {
    if (e.buttons !== 0 || hot === key) return
    const next = make()
    setHot(next != null ? key : null)
    showStructurePreview(next)
  }
  const undraw = (key: string) => () => {
    if (hot !== key) return
    setHot(null)
    showStructurePreview(null)
  }

  const { card, gap } = placed
  const edges = (['top', 'bottom', 'left', 'right'] as const).map((side) => {
    const axis: GridAxis = side === 'top' || side === 'bottom' ? 'rows' : 'columns'
    const [start, end] = spanOf(cell.area, axis)
    const before = side === 'top' || side === 'left'
    const [first, last] = sliverRun(layout, axis, before ? start : end, placed.sizes[axis])
    // Sized from the selection's own track beside the line (`insertTrackAt`'s `from`; a sliver in the run counts as none).
    const from = before ? start : end - 1
    const noun = axis === 'columns' ? 'column' : 'row'
    const where = runPlaceWords(trackNames(layout, axis, placed.sizes[axis]), first, last, noun)
    const x = axis === 'rows' ? card.left + card.width / 2
      : before ? Math.max(TAB_CLEAR_PX, card.left - gap / 2) : Math.min(placed.right - TAB_CLEAR_PX, card.left + card.width + gap / 2)
    const y = axis === 'columns' ? card.top + card.height / 2
      : before ? Math.max(TAB_CLEAR_PX, card.top - gap / 2) : Math.min(placed.bottom - TAB_CLEAR_PX, card.top + card.height + gap / 2)
    return { side, axis, first, last, from, where, x, y }
  })

  const insert = (axis: GridAxis, first: number, last: number, from: number) => {
    setHot(null)
    showStructurePreview(null)
    // Widgets in hand (Move / Copy to layout): the new track holds them.
    if (store().editing?.incoming && store().placeIncoming({ kind: 'line', axis, index: first, through: last })) return
    const added = store().insertTrackAt(axis, first, from, last)
    if (added) {
      store().selectEditCell(added)
      focusEditItem(added)
    }
  }

  const choices = mergeChoices(layout, cell.id)

  return (
    <div className={styles.layer} data-edit-selection={cell.id} data-previewing={hot != null ? '' : undefined}>
      {edges.map(({ side, axis, first, last, from, where, x, y }) => {
        const key = `edge:${side}`
        return (
          <button
            key={key}
            type="button"
            className={styles.edgeTab}
            style={{ left: x, top: y }}
            data-side={side}
            data-hot={hot === key ? '' : undefined}
            data-edge-tab={side}
            aria-label={`Insert ${EDGE_WORDS[side].toLowerCase()}`}
            onMouseMove={draw(key, () => insertPreview(layout, axis, first, last, where, cellName, from))}
            onMouseLeave={undraw(key)}
            onClick={() => insert(axis, first, last, from)}
          >
            <span aria-hidden="true">+</span>
            <span>{EDGE_WORDS[side]}</span>
          </button>
        )
      })}
      {choices.map((choice) => {
        const box = placed.others[choice.cell.id]
        if (!box) return null
        const key = `merge:${choice.cell.id}`
        const name = cellName(choice.cell)
        const full = mergeButtonWords(choice.kind, name)
        const short = box.width < SHORT_BELOW_PX
        const words = short ? mergeButtonWords(choice.kind, name, true) : full
        const belowStrip = choice.cell.tabs.length > 1 && choice.kind !== 'strip' ? 14 : 0
        const top = Math.min(box.top + box.height - 30, box.top + box.height / 2 + 24 + belowStrip)
        return (
          <button
            key={key}
            type="button"
            className={styles.mergeButton}
            style={{ left: box.left + box.width / 2, top: Math.max(box.top + 3, top), maxWidth: Math.max(48, box.width - 12) }}
            data-hot={hot === key ? '' : undefined}
            data-merge-button={choice.cell.id}
            data-tooltip={short ? full : undefined}
            aria-description={short ? full : undefined}
            onMouseMove={draw(key, () => mergePreview(layout, cell, choice.cell, choice.kind, cellName))}
            onMouseLeave={undraw(key)}
            onClick={() => {
              setHot(null)
              showStructurePreview(null)
              store().mergeCells(cell.id, choice.cell.id)
              store().selectEditCell(cell.id)
              focusEditItem(cell.id)
            }}
          >
            <span aria-hidden="true">{MERGE_ARROW[choice.side]}</span>
            <span className={styles.mergeWords}>{words}</span>
          </button>
        )
      })}
    </div>
  )
}
