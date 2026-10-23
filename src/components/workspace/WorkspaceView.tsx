import { Fragment, type CSSProperties } from 'react'
import type { BandEdge, LayoutBand, LayoutColumn, WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { columnEdgeXs, EDGE_ZONE_GUTTER_PX, freeBandEdges } from '../../utils/workspace-drop'
import { BAND_MIN_PX, CELL_MIN_PX, COLUMN_MIN_PX } from '../../utils/workspace-resize'
import { EmptyColumnArea, WorkspaceCell } from './WorkspaceCell'
import { WorkspaceDivider } from './WorkspaceDivider'
import { BandDivider } from './BandDivider'
import { AddWidgetButtons } from './AddWidgetFlow'
import { useWorkspaceDrag } from './workspace-drag'
import styles from './WorkspaceView.module.css'

function EmptyLayout() {
  return (
    <div className={styles.emptyLayout}>
      <p className={styles.emptyTitle}>This layout is empty</p>
      <p className={styles.emptyHint}>Pick a widget to start the first column.</p>
      <div className={styles.tiles}>
        <AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={styles.tile} iconClassName={styles.tileIcon} iconSize={16} />
      </div>
      <p className={styles.emptyHint}>Or open another layout from the top bar.</p>
    </div>
  )
}

function Column({ column }: { column: LayoutColumn }) {
  const setCellWeights = useWorkspaceStore((s) => s.setCellWeights)
  const endResize = useWorkspaceStore((s) => s.endResize)
  const setCellCollapsed = useWorkspaceStore((s) => s.setCellCollapsed)
  return (
    <div
      className={styles.column}
      style={{ flexGrow: column.weight } as CSSProperties}
      data-ws-column={column.id}
    >
      {column.cells.map((cell, i) => {
        const prev = column.cells[i - 1]
        const style: CSSProperties = cell.collapsed ? { flex: '0 0 auto' } : { flex: `${cell.weight} 1 0px` }
        return (
          <Fragment key={cell.id}>
            {prev && (prev.collapsed || cell.collapsed ? (
              <div className={styles.cellGap} aria-hidden="true" />
            ) : (
              <WorkspaceDivider
                between="cells"
                aId={prev.id}
                bId={cell.id}
                weightA={prev.weight}
                weightB={cell.weight}
                min={CELL_MIN_PX}
                onResize={setCellWeights}
                onResizeEnd={endResize}
                onCollapse={(id) => { void setCellCollapsed(id, true) }}
                label="Resize cells"
              />
            ))}
            <WorkspaceCell cell={cell} style={style} />
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * A full-width band: a cell spanning the workspace. Its stored height is
 * drawn at least `BAND_MIN_PX`; when the window is short it shrinks (down to
 * its header) so the column area keeps its minimum.
 */
function Band({ edge, band }: { edge: BandEdge; band: LayoutBand }) {
  const style: CSSProperties = band.collapsed
    ? { flex: '0 0 auto' }
    : { flex: `0 1 ${Math.max(BAND_MIN_PX, band.height)}px` }
  return <WorkspaceCell cell={band} band={edge} style={style} />
}

/** The gutter between a band and the column area: a resize handle, or a plain gap while the band is collapsed. */
function BandGutter({ edge, band }: { edge: BandEdge; band: LayoutBand }) {
  if (band.collapsed) return <div className={styles.cellGap} aria-hidden="true" />
  return <BandDivider edge={edge} band={band} />
}

/**
 * Drag feedback drawn over the workspace: idle column-edge bars (over the
 * column area) and band-edge bars (where no band is), the active new-column
 * band, the new-band strip, and the new-cell insertion bar.
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

  let bar: CSSProperties | null = null
  if (hit?.kind === 'cell-body' && hit.zone !== 'middle' && accepts) {
    for (const col of geo.columns) {
      const cell = col.cells.find((c) => c.id === hit.cellId)
      if (!cell) continue
      const y = hit.zone === 'top' ? cell.rect.top - 4.5 : cell.rect.bottom + 1.5
      bar = { left: cell.rect.left, top: y, width: cell.rect.right - cell.rect.left }
    }
  }

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
      {bar && <div className={styles.cellBar} style={bar} data-testid="ws-new-cell-bar" />}
    </div>
  )
}

/**
 * The open layout, filling the page: the top band, the column area (columns
 * of cells with resize dividers; it alone scrolls sideways when the columns
 * don't fit), and the bottom band.
 */
export function WorkspaceView({ layout }: { layout: WorkspaceLayout }) {
  const setColumnWeights = useWorkspaceStore((s) => s.setColumnWeights)
  const endResize = useWorkspaceStore((s) => s.endResize)
  const { top, bottom } = layout
  const hasBands = top != null || bottom != null
  return (
    <div className={styles.area} data-ws-area>
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
                  <Column column={column} />
                </Fragment>
              )
            })}
      </div>
      {bottom && <BandGutter edge="bottom" band={bottom} />}
      {bottom && <Band edge="bottom" band={bottom} />}
      <DragOverlayLayer />
    </div>
  )
}
