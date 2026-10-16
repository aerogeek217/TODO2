import { Fragment, type CSSProperties } from 'react'
import type { LayoutColumn, WorkspaceLayout } from '../../models/workspace-layout'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { columnEdgeXs, EDGE_ZONE_GUTTER_PX } from '../../utils/workspace-drop'
import { CELL_MIN_PX, COLUMN_MIN_PX } from '../../utils/workspace-resize'
import { WorkspaceCell } from './WorkspaceCell'
import { WorkspaceDivider } from './WorkspaceDivider'
import { AddWidgetButtons } from './AddWidgetFlow'
import { useTabDrag } from './workspace-drag'
import styles from './WorkspaceView.module.css'

function EmptyLayout() {
  return (
    <div className={styles.emptyLayout}>
      <p className={styles.emptyTitle}>This layout is empty</p>
      <p className={styles.emptyHint}>Pick a widget to start the first column.</p>
      <div className={styles.tiles}>
        <AddWidgetButtons target={{ kind: 'layout' }} buttonClassName={styles.tile} iconClassName={styles.tileIcon} iconSize={16} />
      </div>
      <p className={styles.emptyHint}>Or choose a saved layout from the picker above.</p>
    </div>
  )
}

function Column({ column }: { column: LayoutColumn }) {
  const setCellWeights = useWorkspaceStore((s) => s.setCellWeights)
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

/** Drag feedback drawn over the workspace: idle column-edge bars, the active new-column band, the new-cell insertion bar. */
function DragOverlayLayer() {
  const drag = useTabDrag()
  if (!drag) return null
  const { geometry: geo, hit, accepts } = drag
  const top = geo.area.top
  const height = geo.area.bottom - geo.area.top
  const edges = columnEdgeXs(geo)

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
            style={{ left: Math.max(geo.area.left, Math.min(geo.area.right - EDGE_ZONE_GUTTER_PX * 2, x - EDGE_ZONE_GUTTER_PX)), top, height }}
          />
        ) : (
          <div key={g} className={styles.edgeBar} style={{ left: x - 1, top, height }} />
        )
      })}
      {bar && <div className={styles.cellBar} style={bar} data-testid="ws-new-cell-bar" />}
    </div>
  )
}

/** The open layout, filling the page: columns of cells, with resize dividers between them. */
export function WorkspaceView({ layout }: { layout: WorkspaceLayout }) {
  const setColumnWeights = useWorkspaceStore((s) => s.setColumnWeights)
  if (layout.columns.length === 0) {
    return (
      <div className={styles.area} data-ws-area>
        <EmptyLayout />
      </div>
    )
  }
  return (
    <div className={styles.area} data-ws-area>
      {layout.columns.map((column, i) => {
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
                label="Resize columns"
              />
            )}
            <Column column={column} />
          </Fragment>
        )
      })}
      <DragOverlayLayer />
    </div>
  )
}

