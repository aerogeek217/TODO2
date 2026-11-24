import { memo, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { getActiveTab, type LayoutCell, type LayoutTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { edgeBetween, edgeStretches, isWholeLine, spanOf, stretchCells, type EdgeStretch } from '../../utils/workspace-grid'
import { previewedLayout } from '../../utils/workspace-preview'
import { absorbedCellIds, withStructurePreview } from '../../utils/structure-preview'
import { useWorkspaceStore, type ResizeHandle } from '../../stores/workspace-store'
import { cellTouchesCollapsedColumn, columnStrips, EDIT_GUTTER_PX, isCellCollapsedIn, rowDrawsFitFaces, trackSizing, trackTemplate, WORKSPACE_GUTTER_PX } from '../../utils/workspace-table'
import { isFitTrack } from '../../utils/workspace-rows'
import { pairPercent } from '../../utils/workspace-resize'
import { WorkspaceCell } from './WorkspaceCell'
import { WorkspaceDivider, type DividerCollapse, type DividerValue } from './WorkspaceDivider'
import { ColumnStrip } from './ColumnStrip'
import { AddWidgetButtons } from './AddWidgetFlow'
import { EmptyState } from '../shared/EmptyState'
import { hueAttr, hueColor } from '../../utils/layout-hue'
import { useWorkspaceDrag } from './workspace-drag'
import { useExpandOrphanTracks } from './use-expand-orphan-tracks'
import { useTabTitles } from './widget-hooks'
import { AmbienceBackdrop, AmbienceLamp } from '../ambience/AmbienceWorkspace'
// The layout edit mode: the headers in the table's frame, the selection's edge tabs and merge buttons.
import { LayoutRulers } from './LayoutRulers'
import { EditSelection } from './EditSelection'
import { useDrawnTracks } from './use-drawn-tracks'
// Layout edit mode E3: the cards' ruler names and the corner's stretch preview.
import { LayoutEditViewContext, type LayoutEditView, type StretchPreview } from './layout-edit-view'
import { stretchLabel } from './edit-card-actions'
import { trackNames } from '../../utils/layout-rulers'
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

/**
 * Whether a stretch gets a divider: a line beside a collapsed row or column
 * has nothing to resize (a Numbers-only row's can: it takes a fixed
 * height), and a row line's stretch along collapsed columns only lies
 * inside their strip.
 */
function resizable(layout: WorkspaceLayout, stretch: EdgeStretch): boolean {
  if (stretch.axis === 'rows' && layout.grid.columns.slice(stretch.from, stretch.to).every((t) => t.collapsed === true)) return false
  return [stretch.line - 1, stretch.line].every((t) => trackSizing(layout, stretch.axis, t).kind !== 'collapsed')
}

/**
 * What a divider's pill collapses on each side of its stretch (track ids):
 * every track of its axis the cells beside it there cover, collapsed
 * together as Collapse row collapses a cell's rows — none when no cell there
 * holds a widget (a folded track no widget lies only in opens again at once).
 */
function dividerCollapse(layout: WorkspaceLayout, stretch: EdgeStretch): DividerCollapse {
  const { before, after } = stretchCells(layout, stretch)
  const side = (cells: readonly LayoutCell[]): string[] => {
    if (!cells.some((c) => c.tabs.length > 0)) return []
    const spans = cells.map((c) => spanOf(c.area, stretch.axis))
    const start = Math.min(...spans.map(([s]) => s))
    const end = Math.max(...spans.map(([, e]) => e))
    return layout.grid[stretch.axis].slice(start, end).map((t) => t.id)
  }
  return { before: side(before), after: side(after) }
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
  if (!handle) return items
  const edge = edgeBetween(layout, handle.beforeId, handle.afterId)
  if (!edge || edge.axis !== handle.axis) return items
  const dragged = { key: `${handle.axis}:${handle.beforeId}|${handle.afterId}`, beforeId: handle.beforeId, afterId: handle.afterId }
  const holds = (s: EdgeStretch) => s.axis === edge.axis && s.line === edge.line && s.from <= edge.from && s.to >= edge.to
  const at = items.findIndex((d) => holds(d.stretch))
  const others = items.map((d, i) => (i === at ? { ...d, ...dragged } : d)).filter((d, i) => i === at || d.key !== dragged.key)
  return at >= 0 ? others : [...others, { stretch: edge, ...dragged }]
}

/**
 * One divider per stretch of grid line between cells (`edgeStretches`),
 * labelled with the cells beside it. (Layout edit mode E4: no crossing
 * handles — a divider's plain drag moves its whole line, Alt-drag its piece.)
 */
function Dividers({ layout, handle, pills }: {
  layout: WorkspaceLayout
  handle: ResizeHandle | null
  /** Each divider's collapse pill (outside the layout edit mode). */
  pills: boolean
}) {
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
          // E4: a plain drag moves the whole line; Alt-drag breaks a piece that is part of one off.
          partOfLine={!isWholeLine(layout, stretch)}
          collapse={pills ? dividerCollapse(layout, stretch) : undefined}
        />
      ))}
    </>
  )
}

/**
 * One cell of the table, rendered again only when something of its own
 * changed: its `cell` (the layout ops keep an untouched cell's object), the
 * row tracks it covers, its collapse, its fit row or its place. Before, every
 * change of the layout object — a tab switched in another cell, a divider's
 * end, a widget added — and every render of the page above (Settings or the
 * palette opening) rendered every cell and every widget in it (cr34 M16).
 * The props a cell takes as objects are rebuilt from plain values here, so
 * they stay the same objects between renders.
 */
const TableCell = memo(function TableCell({ cell, rowTracks, columnTracks, collapsed, columnCollapsed, fitRow, gridArea, gone = false }: {
  cell: LayoutCell
  /** The ids of the row tracks it covers, as JSON (a string compares by its content; an id may hold any character). */
  rowTracks: string
  /** The ids of the column tracks it covers, as JSON. */
  columnTracks: string
  collapsed: boolean
  /** Some column track it covers is collapsed. */
  columnCollapsed: boolean
  fitRow: boolean
  gridArea: string
  /** A merge's preview took its tabs: drawn hidden under the merged cell, so its widgets stay mounted. */
  gone?: boolean
}) {
  const rowTrackIds = useMemo(() => JSON.parse(rowTracks) as string[], [rowTracks])
  const columnTrackIds = useMemo(() => JSON.parse(columnTracks) as string[], [columnTracks])
  const style = useMemo<CSSProperties>(() => (gone ? { gridArea, visibility: 'hidden' } : { gridArea }), [gridArea, gone])
  return (
    <WorkspaceCell
      cell={cell}
      rowTrackIds={rowTrackIds}
      columnTrackIds={columnTrackIds}
      collapsed={collapsed}
      columnCollapsed={columnCollapsed}
      fitRow={fitRow}
      style={style}
    />
  )
})

/** No table to measure (outside the layout edit mode). */
const UNMEASURED_TABLE = { current: null }

/**
 * The layout's table as one CSS grid (D26): each track sized by
 * `workspace-table.trackTemplate` (weights as `fr` never under the cells'
 * minimums — the table scrolls when they don't fit —, px, a fit row
 * `auto`, a collapsed row its header, a collapsed column its strip), each
 * cell placed on its area — outside the layout edit mode the cells lying
 * only in collapsed columns drawn as those columns' strips (`ColumnStrip`) —,
 * and a divider in the gutter along each stretch of grid line, with its
 * collapse pill outside the mode. While a resize
 * drag previews a structural move (`resizePreview`), the table draws as its
 * release will leave it: the preview's tracks, each cell (the same element,
 * keyed by its id) at its area there.
 */
function Table({ layout: working }: { layout: WorkspaceLayout }) {
  const preview = useWorkspaceStore((s) => s.resizePreview)
  const editing = useWorkspaceStore((s) => s.editing != null)
  const structure = useWorkspaceStore((s) => (s.editing != null && s.structurePreview?.layoutId === working.id ? s.structurePreview : null))
  const live = preview != null && preview.layoutId === working.id ? preview : null
  const layout = useMemo(() => (
    structure ? withStructurePreview(working, structure.body, structure.newCellIds)
      : live ? previewedLayout(working, live.body) : working
  ), [working, live, structure])
  const newIds = useMemo(() => new Set(structure?.newCellIds ?? []), [structure])
  const goneIds = useMemo(() => new Set(structure ? absorbedCellIds(working, structure.body) : []), [working, structure])
  const selectedId = useWorkspaceStore((s) => s.editing?.selectedCellId ?? null)
  const { rows, columns } = layout.grid
  // Outside the mode a collapsed column is its strips; in the mode its cells are cards like any other.
  const strips = useMemo(() => (editing ? [] : columnStrips(layout)), [editing, layout])
  const stripped = useMemo(() => new Set(strips.flatMap((s) => s.cells.map((c) => c.id))), [strips])
  const tableRef = useRef<HTMLDivElement | null>(null)
  // Measured only in the mode (the cards' and slots' ruler names).
  const drawn = useDrawnTracks(editing ? tableRef : UNMEASURED_TABLE, layout)
  const [stretch, setStretch] = useState<StretchPreview | null>(null)
  const editView = useMemo<LayoutEditView | null>(() => (editing ? {
    names: { columns: trackNames(layout, 'columns', drawn.columns), rows: trackNames(layout, 'rows', drawn.rows) },
    setStretch,
  } : null), [editing, layout, drawn])
  const stretched = editing && stretch ? layout.cells.find((c) => c.id === stretch.cellId) : undefined
  return (
    <LayoutEditViewContext.Provider value={editView}>
    <div
      ref={tableRef}
      className={styles.table}
      style={{
        gridTemplateColumns: trackTemplate(layout, 'columns', editing ? EDIT_GUTTER_PX : WORKSPACE_GUTTER_PX),
        gridTemplateRows: trackTemplate(layout, 'rows', editing ? EDIT_GUTTER_PX : WORKSPACE_GUTTER_PX),
      }}
      data-ws-table
      data-ws-row-tracks={rows.map((t) => t.id).join(' ')}
      data-structure-preview={structure ? '' : undefined}
    >
      {/* The layout edit mode's headers (first, so they come first in the Tab order). */}
      <LayoutRulers layout={layout} />
      {layout.cells.flatMap((cell): ReactNode[] => {
        const { col, row, colSpan, rowSpan } = cell.area
        if (newIds.has(cell.id)) {
          // A preview's new slot: where the edit would put an empty cell.
          return [
            <div
              key={cell.id}
              className={styles.previewNew}
              style={{ gridArea: `${row + 1} / ${col + 1} / span ${rowSpan} / span ${colSpan}` }}
              data-preview-new=""
              aria-hidden="true"
            />,
          ]
        }
        if (stripped.has(cell.id)) return []
        const tracks = rows.slice(row, row + rowSpan)
        const drawnCell = (
          <TableCell
            key={cell.id}
            cell={cell}
            rowTracks={JSON.stringify(tracks.map((t) => t.id))}
            columnTracks={JSON.stringify(columns.slice(col, col + colSpan).map((t) => t.id))}
            collapsed={isCellCollapsedIn(layout, cell)}
            columnCollapsed={cellTouchesCollapsedColumn(layout, cell)}
            fitRow={rowSpan === 1 && rowDrawsFitFaces(layout, row)}
            gridArea={`${row + 1} / ${col + 1} / span ${rowSpan} / span ${colSpan}`}
            gone={goneIds.has(cell.id)}
          />
        )
        // The selection's edge tabs and merge buttons right after it: next in the Tab order.
        return editing && cell.id === selectedId
          ? [drawnCell, <EditSelection key="edit-selection" layout={working} tableRef={tableRef} />]
          : [drawnCell]
      })}
      {strips.map((s) => (
        <ColumnStrip
          key={`strip:${s.trackIds.join(' ')}:${s.r0}`}
          strip={s}
          style={{ gridArea: `${s.r0 + 1} / ${s.c0 + 1} / ${s.r1 + 1} / ${s.c1 + 1}` }}
        />
      ))}
      {structure && layout.cells.filter((c) => structure.grewCellIds.includes(c.id)).map((c) => (
        // A cell the edit grows across the new track: outlined over it.
        <div
          key={`grew:${c.id}`}
          className={styles.previewGrew}
          style={{ gridArea: `${c.area.row + 1} / ${c.area.col + 1} / span ${c.area.rowSpan} / span ${c.area.colSpan}` }}
          data-preview-grew={c.id}
          aria-hidden="true"
        >
          {structure.grewLabel !== '' && <span className={styles.previewGrewLabel}>{structure.grewLabel ?? 'stretches'}</span>}
        </div>
      ))}
      {/* While a preview shows, no divider: the table shows an edit not yet made. */}
      {!structure && <Dividers layout={layout} handle={live && layout !== working ? live.handle : null} pills={!editing} />}
      {stretched && stretch && editView && (
        <div
          className={styles.stretchGhost}
          style={{ gridArea: `${stretch.area.row + 1} / ${stretch.area.col + 1} / span ${stretch.area.rowSpan} / span ${stretch.area.colSpan}` }}
          data-testid="ws-stretch-ghost"
          aria-hidden="true"
        >
          <span className={styles.stretchLabel}>{stretchLabel(stretch.area, editView.names)}</span>
        </div>
      )}
    </div>
    </LayoutEditViewContext.Provider>
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

/**
 * The open layout, filling the page: its table of cells, or the empty-layout
 * tiles. A collapsed row or column it arrives with that nothing can expand,
 * expands (`useExpandOrphanTracks`). In the layout edit mode (`data-layout-editing`)
 * the workspace is tinted under a faint dot grid with an accent outline, and
 * each cell is a card (E3, `EditCard`): its content dims and takes no
 * presses — the card's surface under it does, and its tabs; nothing moves.
 */
export function WorkspaceView({ layout }: { layout: WorkspaceLayout }) {
  useExpandOrphanTracks(layout)
  const editing = useWorkspaceStore((s) => s.editing != null)
  return (
    <div
      className={styles.area}
      data-ws-area
      data-layout-editing={editing ? '' : undefined}
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
