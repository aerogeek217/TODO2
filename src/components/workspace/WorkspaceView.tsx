import { useMemo, type CSSProperties } from 'react'
import { getActiveTab, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { cellAtTrack, cellById, edgeBetween, edgeStretches, lineCrossings, stretchCells, type EdgeStretch } from '../../utils/workspace-grid'
import { previewedLayout } from '../../utils/workspace-preview'
import { useWorkspaceStore, type ResizeHandle } from '../../stores/workspace-store'
import { isCellCollapsedIn, rowDrawsFitFaces, trackSizing, trackTemplate, WORKSPACE_GUTTER_PX } from '../../utils/workspace-table'
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

/** A divider to draw: its stretch, its React key and the first cells on either side. */
interface DividerItem {
  stretch: EdgeStretch
  key: string
  beforeId: string
  afterId: string
}

/** A crossing handle to draw: its lines, its React key and its corner cell. */
interface CrossingItem {
  col: number
  row: number
  key: string
  cornerId: string
}

/**
 * The dividers to draw (one per stretch, keyed by its axis and first cells).
 * While a divider drag previews a structural move (`handle`), the dragged
 * divider keeps the key it had when the drag started — wherever its stretch
 * now lies (`edgeBetween` its two cells) —, so the element under the
 * pointer, holding its capture, is never remounted.
 */
function dividerItems(layout: WorkspaceLayout, handle: ResizeHandle | null): DividerItem[] {
  const items: DividerItem[] = []
  for (const stretch of dividerStretches(layout)) {
    const { before, after } = stretchCells(layout, stretch)
    const a = before[0]
    const b = after[0]
    if (a && b) items.push({ stretch, key: `${stretch.axis}:${a.id}|${b.id}`, beforeId: a.id, afterId: b.id })
  }
  if (handle?.kind !== 'divider') return items
  const edge = edgeBetween(layout, handle.beforeId, handle.afterId)
  if (!edge || edge.axis !== handle.axis) return items
  const dragged = { key: `${handle.axis}:${handle.beforeId}|${handle.afterId}`, beforeId: handle.beforeId, afterId: handle.afterId }
  const holds = (s: EdgeStretch) => s.axis === edge.axis && s.line === edge.line && s.from <= edge.from && s.to >= edge.to
  const at = items.findIndex((d) => holds(d.stretch))
  const others = items.map((d, i) => (i === at ? { ...d, ...dragged } : d)).filter((d, i) => i === at || d.key !== dragged.key)
  return at >= 0 ? others : [...others, { stretch: edge, ...dragged }]
}

/**
 * The crossing handles to draw (one per "+" — none on a row line beside a
 * collapsed track —, keyed by the cells above-left and below-right). While
 * a crossing drag previews a structural move (`handle`), the dragged
 * crossing keeps its key and sits at its corner cell's bottom-right, a "+"
 * there or not, so it is never remounted under the pointer.
 */
function crossingItems(layout: WorkspaceLayout, handle: ResizeHandle | null): CrossingItem[] {
  const items: CrossingItem[] = []
  for (const { col, row } of lineCrossings(layout)) {
    if (!rowLineMoves(layout, row)) continue
    const corner = cellAtTrack(layout, col - 1, row - 1)
    const across = cellAtTrack(layout, col, row)
    if (corner && across) items.push({ col, row, key: `${corner.id}|${across.id}`, cornerId: corner.id })
  }
  if (handle?.kind !== 'crossing') return items
  const corner = cellById(layout, handle.cornerId)
  if (!corner) return items
  const col = corner.area.col + corner.area.colSpan
  const row = corner.area.row + corner.area.rowSpan
  const dragged = { col, row, key: handle.key, cornerId: handle.cornerId }
  const at = items.findIndex((x) => x.col === col && x.row === row)
  const others = items.map((x, i) => (i === at ? dragged : x)).filter((x, i) => i === at || x.key !== handle.key)
  return at >= 0 ? others : [...others, dragged]
}

/** One divider per stretch of grid line between cells (`edgeStretches`), labelled with the cells beside it, and a crossing handle at each "+". */
function Dividers({ layout, handle }: { layout: WorkspaceLayout; handle: ResizeHandle | null }) {
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
      {dividerItems(layout, handle).map(({ stretch, key, beforeId, afterId }) => (
        <WorkspaceDivider
          key={key}
          stretch={stretch}
          beforeId={beforeId}
          afterId={afterId}
          label={`Resize ${titleOf(beforeId)} and ${titleOf(afterId)}`}
          value={dividerValue(layout, stretch)}
          style={dividerPlacement(stretch)}
          fitTrackIds={fitTracksBeside(layout, stretch)}
        />
      ))}
      {crossingItems(layout, handle).map(({ col, row, key, cornerId }) => (
        <WorkspaceCrossing key={key} col={col} row={row} cornerId={cornerId} testId={key} />
      ))}
    </>
  )
}

/**
 * The layout's table as one CSS grid (D26): each track sized by
 * `workspace-table.trackTemplate` (weights as `fr` never under the cells'
 * minimums — the table scrolls when they don't fit —, px, a fit row
 * `auto`, a collapsed row its header), each cell placed on its area, and a
 * divider in the gutter along each stretch of grid line. While a resize
 * drag previews a structural move (`resizePreview`), the table draws as its
 * release will leave it: the preview's tracks, each cell (the same element,
 * keyed by its id) at its area there.
 */
function Table({ layout: working }: { layout: WorkspaceLayout }) {
  const preview = useWorkspaceStore((s) => s.resizePreview)
  const live = preview != null && preview.layoutId === working.id ? preview : null
  const layout = useMemo(() => (live ? previewedLayout(working, live.body) : working), [working, live])
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
            fitRow={rowSpan === 1 && rowDrawsFitFaces(layout, row)}
            style={{ gridArea: `${row + 1} / ${col + 1} / span ${rowSpan} / span ${colSpan}` }}
          />
        )
      })}
      <Dividers layout={layout} handle={live && layout !== working ? live.handle : null} />
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
