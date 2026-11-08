import { Fragment, type CSSProperties } from 'react'
import type { BandEdge, LayoutBand, LayoutCellRow, LayoutColumn, WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { columnEdgeXs, EDGE_ZONE_GUTTER_PX, freeBandEdges, type RowGeometry, type WorkspaceDropHit, type WorkspaceGeometry } from '../../utils/workspace-drop'
import { BAND_MIN_PX, CELL_MIN_WIDTH_PX, COLUMN_MIN_PX, expandedWeight } from '../../utils/workspace-resize'
import { isFitRow, isFixedHeightRow, isGlanceRow, rowDividerAt, rowMinHeightPx } from '../../utils/workspace-rows'
import { EmptyColumnArea, WorkspaceCell } from './WorkspaceCell'
import { WorkspaceDivider } from './WorkspaceDivider'
import { BandDivider } from './BandDivider'
import { AddWidgetButtons } from './AddWidgetFlow'
import { EmptyState } from '../shared/EmptyState'
import { hueAttr, hueColor } from '../../utils/layout-hue'
import { useWorkspaceDrag } from './workspace-drag'
import { AmbienceBackdrop, AmbienceLamp } from '../ambience/AmbienceWorkspace'
import styles from './WorkspaceView.module.css'

function EmptyLayout() {
  return (
    <div className={styles.emptyLayout}>
      <EmptyState illustration="layout" title="This layout is empty" text="Pick a widget to start the first column.">
        <div className={styles.tiles}>
          <AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={styles.tile} iconClassName={styles.tileIcon} iconSize={16} />
        </div>
        <p className={styles.emptyHint}>Or open another layout from the top bar.</p>
      </EmptyState>
    </div>
  )
}

/**
 * A row of cells — a column's row or a band — drawn side by side, each by its
 * share of the row's width, with a resize divider between neighbours (the
 * widths are view state, saved at once). A collapsed row folds every cell to
 * its header; a fit row (`isFitRow`) is as tall as its content.
 */
function CellRow({ row, band, style }: { row: LayoutCellRow; band?: BandEdge; style: CSSProperties }) {
  const setCellWeights = useWorkspaceStore((s) => s.setCellWeights)
  const endResize = useWorkspaceStore((s) => s.endResize)
  const collapsed = row.collapsed === true
  const fit = !band && isFitRow(row)
  const glance = isGlanceRow(row)
  const cellsWeight = row.cells.reduce((sum, cell) => sum + cell.weight, 0)
  return (
    <div
      className={[styles.row, collapsed ? styles.rowCollapsed : '', fit ? styles.rowFit : '', glance ? styles.rowGlance : ''].join(' ')}
      style={style}
      data-ws-row={row.id}
      data-ws-band-row={band}
      data-fit={fit ? 'true' : undefined}
    >
      {row.cells.map((cell, i) => {
        const prev = row.cells[i - 1]
        return (
          <Fragment key={cell.id}>
            {prev && (
              <WorkspaceDivider
                between="cells"
                aId={prev.id}
                bId={cell.id}
                weightA={prev.weight}
                weightB={cell.weight}
                min={CELL_MIN_WIDTH_PX}
                onResize={setCellWeights}
                onResizeEnd={endResize}
                label="Resize cells"
              />
            )}
            <WorkspaceCell
              cell={cell}
              band={band}
              rowId={row.id}
              collapsed={collapsed}
              multiRow={row.cells.length > 1}
              fitRow={fit}
              style={{ flex: `${cell.weight / cellsWeight} 1 0px` }}
            />
          </Fragment>
        )
      })}
    </div>
  )
}

function Column({ column, widthShare }: { column: LayoutColumn; widthShare: number }) {
  const setRowWeights = useWorkspaceStore((s) => s.setRowWeights)
  const endResize = useWorkspaceStore((s) => s.endResize)
  const setRowCollapsed = useWorkspaceStore((s) => s.setRowCollapsed)
  const rowsWeight = column.rows.reduce((sum, row) => (isFixedHeightRow(row) ? sum : sum + row.weight), 0)
  return (
    <div
      className={styles.column}
      style={{ flexGrow: widthShare } as CSSProperties}
      data-ws-column={column.id}
    >
      {column.rows.map((row, i) => {
        const style: CSSProperties = isFixedHeightRow(row) ? { flex: '0 0 auto' } : { flex: `${row.weight / rowsWeight} 1 0px` }
        // The rows this gap resizes (across fit rows between them), or none: a plain gap.
        const pair = rowDividerAt(column.rows, i)
        return (
          <Fragment key={row.id}>
            {i > 0 && (pair == null ? (
              <div className={styles.cellGap} aria-hidden="true" />
            ) : (
              <WorkspaceDivider
                between="rows"
                aId={pair.above.id}
                bId={pair.below.id}
                weightA={pair.above.weight}
                weightB={pair.below.weight}
                min={rowMinHeightPx(pair.above)}
                minB={rowMinHeightPx(pair.below)}
                onResize={setRowWeights}
                onResizeEnd={endResize}
                onCollapse={(id) => { void setRowCollapsed(id, true) }}
                label="Resize rows"
              />
            ))}
            <CellRow row={row} style={style} />
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * A full-width band: a row of cells spanning the workspace. Its stored
 * height is drawn at least `BAND_MIN_PX`; when the window is short it
 * shrinks (down to its header) so the column area keeps its minimum.
 */
function Band({ edge, band }: { edge: BandEdge; band: LayoutBand }) {
  const style: CSSProperties = band.collapsed
    ? { flex: '0 0 auto' }
    : { flex: `0 1 ${Math.max(BAND_MIN_PX, band.height)}px` }
  return <CellRow row={band} band={edge} style={style} />
}

/** The gutter between a band and the column area: a resize handle, or a plain gap while the band is collapsed. */
function BandGutter({ edge, band }: { edge: BandEdge; band: LayoutBand }) {
  if (band.collapsed) return <div className={styles.cellGap} aria-hidden="true" />
  return <BandDivider edge={edge} band={band} />
}

/**
 * Where a body zone's new cell or row goes: a horizontal bar above / below
 * the row (in a multi-cell row the whole row's width; else the cell's), or a
 * vertical bar left / right of the cell.
 */
function newCellBar(geo: WorkspaceGeometry, hit: WorkspaceDropHit | null): { style: CSSProperties; vertical: boolean } | null {
  if (hit?.kind !== 'cell-body' && hit?.kind !== 'band-body') return null
  if (hit.zone === 'middle') return null
  const rows: readonly RowGeometry[] = hit.kind === 'band-body' ? geo.bands : geo.columns.flatMap((c) => c.rows)
  for (const row of rows) {
    const cell = row.cells.find((c) => c.id === hit.cellId)
    if (!cell) continue
    const r = cell.rect
    if (hit.zone === 'left' || hit.zone === 'right') {
      const x = hit.zone === 'left' ? r.left - 4.5 : r.right + 1.5
      return { vertical: true, style: { left: x, top: r.top, height: r.bottom - r.top } }
    }
    const span = row.cells.length > 1 ? row.rect : r
    const y = hit.zone === 'top' ? span.top - 4.5 : span.bottom + 1.5
    return { vertical: false, style: { left: span.left, top: y, width: span.right - span.left } }
  }
  return null
}

/**
 * Drag feedback drawn over the workspace: idle column-edge bars (over the
 * column area) and band-edge bars (where no band is), the active new-column
 * band, the new-band strip, and the new-cell / new-row insertion bar.
 */
function DragOverlayLayer() {
  const drag = useWorkspaceDrag()
  if (!drag) return null
  const { geometry: geo, hit, accepts } = drag
  const top = geo.columnArea.top
  const height = geo.columnArea.bottom - geo.columnArea.top
  const edges = columnEdgeXs(geo)
  const gutter = 6
  const stripLeft = geo.area.left + gutter
  const stripWidth = geo.area.right - geo.area.left - gutter * 2

  const bar = accepts ? newCellBar(geo, hit) : null

  return (
    <div className={styles.dragLayer} aria-hidden="true">
      {edges.map((x, g) => {
        const activeBand = hit?.kind === 'column-edge' && hit.gutter === g && accepts
        return activeBand ? (
          <div
            key={g}
            className={styles.edgeBand}
            data-testid="ws-new-column-band"
            style={{ left: Math.max(geo.columnArea.left, Math.min(geo.columnArea.right - EDGE_ZONE_GUTTER_PX * 2, x - EDGE_ZONE_GUTTER_PX)), top, height }}
          />
        ) : (
          <div key={g} className={styles.edgeBar} style={{ left: x - 1, top, height }} />
        )
      })}
      {freeBandEdges(geo).map((edge) => {
        const active = hit?.kind === 'new-band' && hit.edge === edge && accepts
        return active ? (
          <div
            key={edge}
            className={styles.newBandStrip}
            data-testid="ws-new-band-strip"
            data-edge={edge}
            style={{ left: stripLeft, width: stripWidth, top: edge === 'top' ? geo.area.top + 2 : geo.area.bottom - 34 }}
          />
        ) : (
          <div
            key={edge}
            className={styles.edgeBarH}
            data-testid="ws-band-edge-bar"
            style={{ left: stripLeft, width: stripWidth, top: edge === 'top' ? geo.area.top + 2 : geo.area.bottom - 4 }}
          />
        )
      })}
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

/**
 * The open layout, filling the page: the top band, the column area (columns
 * of rows of cells with resize dividers; it alone scrolls sideways when the columns
 * don't fit), and the bottom band.
 */
export function WorkspaceView({ layout }: { layout: WorkspaceLayout }) {
  const setColumnWeights = useWorkspaceStore((s) => s.setColumnWeights)
  const endResize = useWorkspaceStore((s) => s.endResize)
  const { top, bottom } = layout
  const hasBands = top != null || bottom != null
  const columnsWeight = expandedWeight(layout.columns)
  return (
    <div
      className={styles.area}
      data-ws-area
      data-layout-hue={hueAttr(layout.hue)}
      style={{ '--layout-hue': hueColor(layout.hue) } as CSSProperties}
    >
      <Grain />
      <AmbienceBackdrop />
      {top && <Band edge="top" band={top} />}
      {top && <BandGutter edge="top" band={top} />}
      <div className={styles.columnArea} data-ws-columns>
        {layout.columns.length === 0
          ? (hasBands ? <EmptyColumnArea /> : <EmptyLayout />)
          : layout.columns.map((column, i) => {
              const prev = layout.columns[i - 1]
              return (
                <Fragment key={column.id}>
                  {prev && (
                    <WorkspaceDivider
                      between="columns"
                      aId={prev.id}
                      bId={column.id}
                      weightA={prev.weight}
                      weightB={column.weight}
                      min={COLUMN_MIN_PX}
                      onResize={setColumnWeights}
                      onResizeEnd={endResize}
                      label="Resize columns"
                    />
                  )}
                  <Column column={column} widthShare={column.weight / columnsWeight} />
                </Fragment>
              )
            })}
      </div>
      {bottom && <BandGutter edge="bottom" band={bottom} />}
      {bottom && <Band edge="bottom" band={bottom} />}
      <AmbienceLamp />
      <DragOverlayLayer />
    </div>
  )
}
