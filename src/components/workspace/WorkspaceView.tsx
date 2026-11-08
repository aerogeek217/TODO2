import type { CSSProperties } from 'react'
import type { GridTrack, LayoutBody, WorkspaceLayout } from '../../models/workspace-layout'
import { geometryCells, type WorkspaceDropHit, type WorkspaceGeometry } from '../../utils/workspace-drop'
import { CELL_MIN_WIDTH_PX } from '../../utils/workspace-resize'
import { isFitTrack, trackMinHeightPx } from '../../utils/workspace-rows'
import { WorkspaceCell } from './WorkspaceCell'
import { AddWidgetButtons } from './AddWidgetFlow'
import { EmptyState } from '../shared/EmptyState'
import { hueAttr, hueColor } from '../../utils/layout-hue'
import { useWorkspaceDrag } from './workspace-drag'
import { AmbienceBackdrop, AmbienceLamp } from '../ambience/AmbienceWorkspace'
import styles from './WorkspaceView.module.css'

function EmptyLayout() {
  return (
    <div className={styles.emptyLayout}>
      <EmptyState illustration="layout" title="This layout is empty" text="Pick a widget to start the first cell.">
        <div className={styles.tiles}>
          <AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={styles.tile} iconClassName={styles.tileIcon} iconSize={16} />
        </div>
        <p className={styles.emptyHint}>Or open another layout from the top bar.</p>
      </EmptyState>
    </div>
  )
}

/** The weighted tracks' weights summed (fixed, fit and collapsed tracks don't share the free space). */
function weightedTotal(tracks: readonly GridTrack[], shares: (i: number) => boolean): number {
  return tracks.reduce((sum, t, i) => (shares(i) ? sum + (t.weight ?? 0) : sum), 0)
}

/**
 * The grid's template on one axis: a fixed track its px, a weighted one its
 * share of the free space as `fr` (scaled so the shares sum to 100: `fr`
 * under 1 in total would leave space empty), over its minimum; a row track
 * that fits its content or is collapsed `auto`.
 */
function template(body: LayoutBody, axis: 'columns' | 'rows'): string {
  const tracks = body.grid[axis]
  const auto = (i: number) => axis === 'rows' && (tracks[i]?.collapsed === true || isFitTrack(body, i))
  const shares = (i: number) => tracks[i]?.px == null && !auto(i)
  const total = weightedTotal(tracks, shares) || 1
  return tracks.map((t, i) => {
    if (auto(i)) return 'auto'
    if (t.px != null) return `${t.px}px`
    const fr = ((t.weight ?? 0) / total) * 100
    const min = axis === 'columns' ? CELL_MIN_WIDTH_PX : trackMinHeightPx(body, i)
    return `minmax(${min}px, ${fr}fr)`
  }).join(' ')
}

/**
 * The layout's table as one CSS grid: each track sized by `template`, each
 * cell placed on its area. (D26 P1: a plain grid; the dividers, the drop
 * ghost and the cell menu's table words come with P2.)
 */
function Table({ layout }: { layout: WorkspaceLayout }) {
  const { rows } = layout.grid
  return (
    <div
      className={styles.table}
      style={{ gridTemplateColumns: template(layout, 'columns'), gridTemplateRows: template(layout, 'rows') }}
      data-ws-table
    >
      {layout.cells.map((cell) => {
        const { col, row, colSpan, rowSpan } = cell.area
        const tracks = rows.slice(row, row + rowSpan)
        const collapsed = tracks.length > 0 && tracks.every((t) => t.collapsed === true)
        const fitRow = rowSpan === 1 && isFitTrack(layout, row)
        return (
          <WorkspaceCell
            key={cell.id}
            cell={cell}
            rowTrackIds={tracks.map((t) => t.id)}
            collapsed={collapsed}
            fitRow={fitRow}
            style={{ gridArea: `${row + 1} / ${col + 1} / span ${rowSpan} / span ${colSpan}` }}
          />
        )
      })}
    </div>
  )
}

/** Where a split's new cell goes: a bar along that side of the cell. */
function splitBar(geo: WorkspaceGeometry, hit: WorkspaceDropHit | null): { style: CSSProperties; vertical: boolean } | null {
  if (hit?.kind !== 'cell-body' || hit.zone === 'middle') return null
  const cell = geometryCells(geo).find((c) => c.id === hit.cellId)
  if (!cell) return null
  const r = cell.rect
  if (hit.zone === 'left' || hit.zone === 'right') {
    const x = hit.zone === 'left' ? r.left - 4.5 : r.right + 1.5
    return { vertical: true, style: { left: x, top: r.top, height: r.bottom - r.top } }
  }
  const y = hit.zone === 'top' ? r.top - 4.5 : r.bottom + 1.5
  return { vertical: false, style: { left: r.left, top: y, width: r.right - r.left } }
}

/**
 * Drag feedback drawn over the workspace: the insert-row / insert-column
 * strip along the layout's edge, and a split's bar beside the cell.
 */
function DragOverlayLayer() {
  const drag = useWorkspaceDrag()
  if (!drag) return null
  const { geometry: geo, hit, accepts } = drag
  const gutter = 6
  const bar = accepts ? splitBar(geo, hit) : null
  const insert = accepts && hit?.kind === 'insert' ? hit.edge : null
  const { area } = geo
  return (
    <div className={styles.dragLayer} aria-hidden="true">
      {(insert === 'top' || insert === 'bottom') && (
        <div
          className={styles.newBandStrip}
          data-testid="ws-insert-row"
          data-edge={insert}
          style={{ left: area.left + gutter, width: area.right - area.left - gutter * 2, top: insert === 'top' ? area.top + 2 : area.bottom - 34 }}
        />
      )}
      {(insert === 'left' || insert === 'right') && (
        <div
          className={styles.edgeBand}
          data-testid="ws-insert-column"
          data-edge={insert}
          style={{ left: insert === 'left' ? area.left + 2 : area.right - 34, top: area.top + gutter, height: area.bottom - area.top - gutter * 2 }}
        />
      )}
      {bar && <div className={bar.vertical ? styles.cellBarV : styles.cellBar} style={bar.style} data-testid="ws-new-cell-bar" data-axis={bar.vertical ? 'vertical' : 'horizontal'} />}
    </div>
  )
}

/** The workspace grain: fractal noise, desaturated, screened faintly over the app background (dark only). */
function Grain() {
  return (
    <svg className={styles.grain} aria-hidden="true" focusable="false">
      <filter id="ws-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#ws-grain)" />
    </svg>
  )
}

/** The open layout, filling the page: its table of cells, or the empty-layout tiles. */
export function WorkspaceView({ layout }: { layout: WorkspaceLayout }) {
  return (
    <div
      className={styles.area}
      data-ws-area
      data-layout-hue={hueAttr(layout.hue)}
      style={{ '--layout-hue': hueColor(layout.hue) } as CSSProperties}
    >
      <Grain />
      <AmbienceBackdrop />
      {layout.cells.length === 0 ? <EmptyLayout /> : <Table layout={layout} />}
      <AmbienceLamp />
      <DragOverlayLayer />
    </div>
  )
}
