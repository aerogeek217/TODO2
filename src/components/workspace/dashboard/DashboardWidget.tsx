import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import {
  normalizeDashboardConfig,
  type DashboardTileId,
} from '../../../models/dashboard-config'
import type { DashboardTab } from '../../../models/workspace-layout'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { TileStats } from '../../../services/stats/tiles'
import { useUIStore } from '../../../stores/ui-store'
import { nextScopedSelection, readScopeRows } from '../../../utils/scoped-selection'
import { ListBulkBar } from '../list/ListBulkBar'
import type { ListRowSelectMods } from '../list/ListWidgetRow'
import { useElementSize } from '../calendar/use-element-size'
import { countOf, tileSubLine, withScreenNote } from './dashboard-copy'
import { TILES, tileDrill } from './dashboard-tiles'
import { DASHBOARD_WIDE_MIN_PX, packSections, sectionRowTracks, TILES_PER_ROW } from './dashboard-layout'
import { DASHBOARD_SECTIONS } from './dashboard-sections'
import { buildDashboardSummary, type DashboardSummary } from './dashboard-summary'
import { DashGlyph } from './glyphs'
import { useListTileHints } from './use-list-tile-hints'
import type { DashboardRowKit, OnDashboardDrill } from './types'
import { useDashboardData, type DashboardData } from './use-dashboard-data'
import styles from './DashboardWidget.module.css'

/** What the widget reports to its cell: the tab count and the counts for "Copy summary". */
export interface DashboardResult {
  /** Open tasks shown; `shown of total` when the screen filter hides some. */
  countLabel: string
  summary: DashboardSummary
}

/** The Open tile's sparkline: the open count per day over the trend range. */
function Sparkline({ series }: { series: readonly number[] }) {
  if (series.length < 2) return null
  const min = Math.min(...series)
  const max = Math.max(...series)
  const x = (i: number) => 2 + (i * 72) / (series.length - 1)
  const y = (v: number) => 22 - ((v - min) / Math.max(1, max - min)) * 18
  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const last = series.length - 1
  return (
    <svg className={styles.spark} width={76} height={26} viewBox="0 0 76 26" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last)} cy={y(series[last] ?? 0)} r={2.4} fill="var(--color-accent)" />
    </svg>
  )
}

function Tile({ id, data, onDrill }: { id: DashboardTileId; data: DashboardData; onDrill?: OnDashboardDrill }) {
  const def = TILES[id]
  const stats: TileStats = data.tiles.shown
  const ids = stats[id].ids
  const shown = ids.length
  const total = data.tiles.total[id].ids.length
  const sub = tileSubLine(id, stats, { today: data.ctx.today, trendNet: data.trend?.net ?? null, trendRange: data.trendRange })
  const numberColor = shown === 0 ? 'var(--color-text-muted)' : id === 'open' ? 'var(--color-text-primary)' : def.color
  const content = (
    <>
      <span className={styles.tileLabel}><DashGlyph name={def.glyph} size={12} color={def.color} />{def.label}</span>
      <span className={styles.tileCount} style={{ color: numberColor }} data-testid="dash-tile-count">
        {shown}
        {shown !== total && <span className={styles.of}>of {total}</span>}
      </span>
      <span className={styles.tileSub}>{sub}</span>
      {id === 'open' && data.trend && <Sparkline series={data.trend.openSeries} />}
    </>
  )
  const cls = `${styles.tile} ${styles.surface}`
  if (!onDrill) return <div className={cls} data-dash-tile={id} aria-label={`${def.label}: ${countOf(shown, total)}`} role="group">{content}</div>
  return (
    <button
      type="button"
      className={cls}
      data-dash-tile={id}
      aria-label={`${def.label}: ${countOf(shown, total)}. ${sub ? `${sub}. ` : ''}Show tasks`}
      onClick={() => onDrill(tileDrill(id, data))}
    >
      {content}
      <span className={styles.tileGo}><DashGlyph name="chevron" /></span>
    </button>
  )
}

function ListTiles({ data, onDrill, onAddListTile }: {
  data: DashboardData
  onDrill?: OnDashboardDrill
  onAddListTile?: () => void
}) {
  const hints = useListTileHints()
  return (
    <div className={styles.lists} aria-label="List tiles" role="group">
      <span className={styles.listsCaption}>Lists</span>
      {data.listTiles.map((t) => {
        const content = (
          <>
            <DashGlyph name="list" className={styles.listGlyph} />
            <span className={styles.listWords}>
              <span className={styles.listName}>{t.name}</span>
              <span className={styles.listHint}>{hints.get(t.id) ?? ''}</span>
            </span>
            <span className={styles.listCount} style={{ color: t.shown === 0 ? 'var(--color-text-muted)' : undefined }} data-testid="dash-list-count">
              {t.shown}
              {t.shown !== t.total && <span className={styles.of}>of {t.total}</span>}
            </span>
          </>
        )
        const cls = `${styles.listTile} ${styles.surface}`
        return onDrill ? (
          <button
            key={t.id}
            type="button"
            className={cls}
            data-dash-list-tile={t.id}
            aria-label={`${t.name}: ${countOf(t.shown, t.total)}. Show tasks`}
            onClick={() => onDrill({
              title: t.name,
              glyph: 'list',
              description: `Saved list · ${hints.get(t.id) ?? 'All tasks'}`,
              source: { kind: 'list', listDefinitionId: t.id },
            })}
          >
            {content}
          </button>
        ) : (
          <div key={t.id} className={cls} data-dash-list-tile={t.id}>{content}</div>
        )
      })}
      {onAddListTile && (
        <button type="button" className={styles.addListTile} onClick={onAddListTile}>
          <DashGlyph name="plus" size={12} strokeWidth={2} />
          Add list tile
        </button>
      )}
    </div>
  )
}

export interface DashboardWidgetProps {
  tab: DashboardTab
  onResult?: (r: DashboardResult) => void
  /** Opens the tasks behind a clicked number; absent = numbers aren't clickable. */
  onDrill?: OnDashboardDrill
  /** Opens Customize at its list tiles ("+ Add list tile"); absent = no button. */
  onAddListTile?: () => void
}

/**
 * The Dashboard widget: counts and charts over the open tasks that pass the
 * screen filter, laid out from the tab's config (tiles, list tiles,
 * sections — order and visibility). Built for one cell filling the
 * workspace; below ~1100px of cell width it's one scrolling column.
 */
export function DashboardWidget({ tab, onResult, onDrill: onDrillProp, onAddListTile }: DashboardWidgetProps) {
  const config = useMemo(() => normalizeDashboardConfig(tab.config), [tab.config])
  const data = useDashboardData(config)
  // Under the top-bar filter every dialog says it counts only what it shows.
  const onDrill: OnDashboardDrill | undefined = onDrillProp && ((d) => onDrillProp(
    data.filtered ? { ...d, description: withScreenNote(d.description) } : d,
  ))
  const isMobile = useIsMobile()
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const inScope = useUIStore((s) => s.selectionScope === tab.id)
  const selectedIds = useUIStore((s) => s.selectedTodoIds)
  const cursorKey = useUIStore((s) => (s.selectionScope === tab.id ? s.selectionCursorKey : null))
  const [sizeRef, size] = useElementSize()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el
    sizeRef(el)
  }, [sizeRef])

  const countLabel = countOf(data.tiles.shown.open.ids.length, data.tiles.total.open.ids.length)
  const summary = useMemo(
    () => buildDashboardSummary(config.tiles, data.tiles, data.listTiles),
    [config.tiles, data.tiles, data.listTiles],
  )
  const onResultRef = useLatestRef(onResult)
  useEffect(() => {
    onResultRef.current?.({ countLabel, summary })
  }, [countLabel, summary, onResultRef])

  const onSelect = useCallback((key: string, _todoId: number, mods: ListRowSelectMods) => {
    const root = rootRef.current
    if (!root) return
    const ui = useUIStore.getState()
    const next = nextScopedSelection(
      { scope: ui.selectionScope, ids: ui.selectedTodoIds, anchorKey: ui.selectionAnchorKey },
      tab.id,
      readScopeRows(root),
      key,
      mods.shift ? 'range' : mods.ctrl ? 'toggle' : 'one',
    )
    if (next) ui.setScopedSelection(tab.id, next)
  }, [tab.id])

  const rows: DashboardRowKit = { tabId: tab.id, isMobile, inScope, selectedIds, cursorKey, onSelect, onOpen: openEditPopup }

  const wide = !isMobile && (size.width === 0 || size.width >= DASHBOARD_WIDE_MIN_PX)
  const showLists = data.listTiles.length > 0 || onAddListTile != null
  const sectionRows = packSections(config.sections.map((s) => ({ id: s.id, span: DASHBOARD_SECTIONS[s.id].defaultSpan })))
  const optionsOf = new Map(config.sections.map((s) => [s.id, s.options ?? {}]))

  const tracks: string[] = []
  if (config.tiles.length > 0) tracks.push('auto')
  if (showLists) tracks.push('56px')
  tracks.push(...sectionRowTracks(sectionRows.length))

  const sections: ReactNode[] = sectionRows.flatMap((row) => row.map((placed) => {
    const { Component } = DASHBOARD_SECTIONS[placed.id]
    return (
      <Component
        key={placed.id}
        data={data}
        options={optionsOf.get(placed.id) ?? {}}
        rows={rows}
        onDrill={onDrill}
        style={wide ? { gridColumn: `span ${placed.span}` } : undefined}
      />
    )
  }))

  const showBulkBar = !isMobile && inScope && selectedIds.size >= 2
  const tileRows = Math.ceil(config.tiles.length / TILES_PER_ROW)

  return (
    <div
      ref={setRootRef}
      className={`${styles.widget} ${wide ? styles.grid : styles.narrow}`}
      style={wide ? { gridTemplateRows: tracks.join(' ') } : undefined}
      data-dashboard={tab.id}
      data-layout={wide ? 'grid' : 'column'}
      data-selection-scope={isMobile ? undefined : tab.id}
      onClick={(e) => {
        // A click on empty space clears this widget's selection.
        if (inScope && e.target === e.currentTarget) useUIStore.getState().clearSelection()
      }}
    >
      {config.tiles.length > 0 && (
        <div className={styles.tiles} aria-label="Tiles" role="group" data-tile-rows={tileRows}>
          {config.tiles.map((id) => <Tile key={id} id={id} data={data} onDrill={onDrill} />)}
        </div>
      )}
      {showLists && <ListTiles data={data} onDrill={onDrill} onAddListTile={onAddListTile} />}
      {sections}
      {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={12} />}
    </div>
  )
}
