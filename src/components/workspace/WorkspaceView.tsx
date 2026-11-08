import { useMemo, type CSSProperties } from 'react'
import { getActiveTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { edgeStretches, stretchCells, type EdgeStretch } from '../../utils/workspace-grid'
import { isCellCollapsedIn, trackSizing, trackTemplate, WORKSPACE_GUTTER_PX } from '../../utils/workspace-table'
import { isFitTrack } from '../../utils/workspace-rows'
import { pairPercent } from '../../utils/workspace-resize'
import { WorkspaceCell } from './WorkspaceCell'
import { WorkspaceDivider } from './WorkspaceDivider'
import { AddWidgetButtons } from './AddWidgetFlow'
import { EmptyState } from '../shared/EmptyState'
import { hueAttr, hueColor } from '../../utils/layout-hue'
import { useWorkspaceDrag } from './workspace-drag'
import { useTabTitles } from './widget-hooks'
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

/** Whether a stretch gets a divider: a row line beside a fit or collapsed track has nothing to resize. */
function resizable(layout: WorkspaceLayout, stretch: EdgeStretch): boolean {
  if (stretch.axis === 'columns') return true
  return [stretch.line - 1, stretch.line].every((t) => {
    const kind = trackSizing(layout, 'rows', t).kind
    return kind === 'weighted' || kind === 'fixed'
  })
}

/** The share (%) the track before a stretch's line has of it and the track after (weights, or px for fixed ones). */
function lineShare(layout: WorkspaceLayout, stretch: EdgeStretch): number {
  const tracks = layout.grid[stretch.axis]
  const size = (i: number) => {
    const t = tracks[i]
    return t ? (t.px ?? t.weight ?? 0) : 0
  }
  return pairPercent(size(stretch.line - 1), size(stretch.line))
}

/** Where a divider sits in the grid: the gutter before the track after its line, along its stretch. */
function dividerPlacement(stretch: EdgeStretch): CSSProperties {
  const { line, from, to } = stretch
  return stretch.axis === 'columns'
    ? { gridColumn: `${line + 1} / span 1`, gridRow: `${from + 1} / ${to + 1}` }
    : { gridRow: `${line + 1} / span 1`, gridColumn: `${from + 1} / ${to + 1}` }
}

/** One divider per stretch of grid line between cells (`edgeStretches`), labelled with the cells beside it. */
function Dividers({ layout }: { layout: WorkspaceLayout }) {
  const active = useMemo(() => layout.cells.map((c) => getActiveTab(c)).filter((t): t is LayoutTab => t != null), [layout.cells])
  const titles = useTabTitles(active)
  const titleOf = (cellId: string | undefined) => {
    const cell = layout.cells.find((c) => c.id === cellId)
    const tab = cell ? getActiveTab(cell) : undefined
    const i = tab ? active.indexOf(tab) : -1
    return i >= 0 ? (titles[i] ?? '') : 'Empty cell'
  }
  return (
    <>
      {edgeStretches(layout).filter((s) => resizable(layout, s)).map((stretch) => {
        const { before, after } = stretchCells(layout, stretch)
        const a = before[0]
        const b = after[0]
        if (!a || !b) return null
        return (
          <WorkspaceDivider
            key={`${stretch.axis}:${stretch.line}:${stretch.from}`}
            stretch={stretch}
            beforeId={a.id}
            afterId={b.id}
            label={`Resize ${titleOf(a.id)} and ${titleOf(b.id)}`}
            valueNow={lineShare(layout, stretch)}
            style={dividerPlacement(stretch)}
          />
        )
      })}
    </>
  )
}

/**
 * The layout's table as one CSS grid (D26): each track sized by
 * `workspace-table.trackTemplate` (weights as `fr` never under the cells'
 * minimums — the table scrolls when they don't fit —, px, a fit row
 * `auto`, a collapsed row its header), each cell placed on its area, and a
 * divider in the gutter along each stretch of grid line.
 */
function Table({ layout }: { layout: WorkspaceLayout }) {
  const { rows } = layout.grid
  return (
    <div
      className={styles.table}
      style={{
        gridTemplateColumns: trackTemplate(layout, 'columns', WORKSPACE_GUTTER_PX),
        gridTemplateRows: trackTemplate(layout, 'rows', WORKSPACE_GUTTER_PX),
      }}
      data-ws-table
      data-ws-row-tracks={rows.map((t) => t.id).join(' ')}
    >
      {layout.cells.map((cell) => {
        const { col, row, colSpan, rowSpan } = cell.area
        const tracks = rows.slice(row, row + rowSpan)
        return (
          <WorkspaceCell
            key={cell.id}
            cell={cell}
            rowTrackIds={tracks.map((t) => t.id)}
            collapsed={isCellCollapsedIn(layout, cell)}
            fitRow={rowSpan === 1 && isFitTrack(layout, row)}
            style={{ gridArea: `${row + 1} / ${col + 1} / span ${rowSpan} / span ${colSpan}` }}
          />
        )
      })}
      <Dividers layout={layout} />
    </div>
  )
}

/**
 * Drag feedback drawn over the workspace (D26 board T): one ghost at the
 * place and size the drop will produce (`workspace-drop.dropGhost`),
 * labelled in words. Hidden from assistive tech: the drop is said by the
 * drag's announcements.
 */
function DragOverlayLayer() {
  const drag = useWorkspaceDrag()
  if (!drag) return null
  const ghost = drag.accepts ? drag.ghost : null
  return (
    <div className={styles.dragLayer} aria-hidden="true">
      {ghost && (
        <div
          // A new ghost per drop spot: each fades in (reduced motion: at once).
          key={`${ghost.rect.left},${ghost.rect.top},${ghost.rect.right},${ghost.rect.bottom}`}
          className={styles.ghost}
          data-testid="ws-drop-ghost"
          style={{
            left: ghost.rect.left,
            top: ghost.rect.top,
            width: ghost.rect.right - ghost.rect.left,
            height: ghost.rect.bottom - ghost.rect.top,
          }}
        >
          <span className={styles.ghostLabel} data-testid="ws-drop-label">{ghost.label}</span>
        </div>
      )}
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
