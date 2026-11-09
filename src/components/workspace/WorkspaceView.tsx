import { useMemo, type CSSProperties } from 'react'
import { getActiveTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { cellAtTrack, edgeStretches, lineCrossings, stretchCells, type EdgeStretch } from '../../utils/workspace-grid'
import { isCellCollapsedIn, trackSizing, trackTemplate, WORKSPACE_GUTTER_PX } from '../../utils/workspace-table'
import { isFitTrack } from '../../utils/workspace-rows'
import { pairPercent } from '../../utils/workspace-resize'
import { WorkspaceCell } from './WorkspaceCell'
import { WorkspaceDivider, type DividerValue } from './WorkspaceDivider'
import { WorkspaceCrossing } from './WorkspaceCrossing'
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

/** Whether row line `line` can move: no collapsed row track beside it (a Numbers-only row can: it takes a fixed height). */
function rowLineMoves(layout: WorkspaceLayout, line: number): boolean {
  return [line - 1, line].every((t) => trackSizing(layout, 'rows', t).kind !== 'collapsed')
}

/** Whether a stretch gets a divider: a row line beside a collapsed track has nothing to resize. */
function resizable(layout: WorkspaceLayout, stretch: EdgeStretch): boolean {
  return stretch.axis === 'columns' || rowLineMoves(layout, stretch.line)
}

/** The Numbers-only (fit) row tracks beside a row stretch — fitting, or given a height by a divider (`isFitTrack`). */
function fitTracksBeside(layout: WorkspaceLayout, stretch: EdgeStretch): string[] {
  if (stretch.axis !== 'rows') return []
  return [stretch.line - 1, stretch.line].flatMap((t) => {
    const track = layout.grid.rows[t]
    return track && track.collapsed !== true && isFitTrack(layout, t) ? [track.id] : []
  })
}

/**
 * The dividers' stretches (`edgeStretches`, a line parting at its "+"
 * crossings) less those with nothing to resize — the pieces of a line
 * beside a Numbers-only row joined back up: its divider moves the row's
 * whole edge (its height).
 */
function dividerStretches(layout: WorkspaceLayout): EdgeStretch[] {
  const out: EdgeStretch[] = []
  for (const s of edgeStretches(layout)) {
    if (!resizable(layout, s)) continue
    const last = out.at(-1)
    if (last && last.axis === s.axis && last.line === s.line && last.to === s.from && fitTracksBeside(layout, s).length > 0) {
      out[out.length - 1] = { ...last, to: s.to }
    } else {
      out.push(s)
    }
  }
  return out
}

/**
 * A divider's value for assistive tech: a whole line between two weighted
 * tracks, the first one's share (%) of the two; beside a fixed track (a
 * former band, or a Numbers-only row given a height), that track's height
 * in px.
 */
function dividerValue(layout: WorkspaceLayout, stretch: EdgeStretch): DividerValue {
  const tracks = layout.grid[stretch.axis]
  const a = tracks[stretch.line - 1]
  const b = tracks[stretch.line]
  const sa = trackSizing(layout, stretch.axis, stretch.line - 1)
  const sb = trackSizing(layout, stretch.axis, stretch.line)
  const fixed = sa.kind === 'fixed' ? sa : sb.kind === 'fixed' ? sb : undefined
  if (fixed) return { now: fixed.px, text: `${fixed.px}px` }
  return { now: pairPercent(a?.weight ?? 0, b?.weight ?? 0), max: 100 }
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
      {dividerStretches(layout).map((stretch) => {
        const { before, after } = stretchCells(layout, stretch)
        const a = before[0]
        const b = after[0]
        if (!a || !b) return null
        return (
          <WorkspaceDivider
            key={`${stretch.axis}:${a.id}|${b.id}`}
            stretch={stretch}
            beforeId={a.id}
            afterId={b.id}
            label={`Resize ${titleOf(a.id)} and ${titleOf(b.id)}`}
            value={dividerValue(layout, stretch)}
            style={dividerPlacement(stretch)}
            fitTrackIds={fitTracksBeside(layout, stretch)}
          />
        )
      })}
      {lineCrossings(layout).filter((x) => rowLineMoves(layout, x.row)).map(({ col, row }) => {
        const corner = cellAtTrack(layout, col - 1, row - 1)
        const across = cellAtTrack(layout, col, row)
        if (!corner || !across) return null
        const id = `${corner.id}|${across.id}`
        return <WorkspaceCrossing key={id} col={col} row={row} cornerId={corner.id} testId={id} />
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
            fitRow={rowSpan === 1 && trackSizing(layout, 'rows', row).kind === 'fit'}
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
