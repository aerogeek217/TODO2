import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  normalizeDashboardConfig,
  type DashboardSectionId,
  type DashboardTileId,
} from '../../../models/dashboard-config'
import type { DashboardTab } from '../../../models/workspace-layout'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { TileStats } from '../../../services/stats/tiles'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { readScopeRows } from '../../../utils/scoped-selection'
import { createValueStore } from '../../../utils/value-store'
import { ListBulkBar } from '../list/ListBulkBar'
import { useElementSize } from '../../../hooks/use-element-size'
import { countOf, tileSubLine, withScreenNote } from './dashboard-copy'
import { TILES, tileColors, tileDrill } from './dashboard-tiles'
import { DASHBOARD_WIDE_MIN_PX, packSections, sectionRowTracks, TILES_PER_ROW } from './dashboard-layout'
import { DASHBOARD_SECTIONS } from './dashboard-sections'
import { buildDashboardSummary, sectionSummaryLines, type DashboardSummary } from './dashboard-summary'
import { DashGlyph } from '../../shared/DashGlyph'
import { GearIcon } from '../../shared/icons'
import { useTooltip } from '../../shared/use-tooltip'
import { useListTileHints } from './use-list-tile-hints'
import type { DashboardRowKit, OnDashboardDrill } from './types'
import { useDashboardData, type DashboardData } from '../../../hooks/use-dashboard-data'
import styles from './DashboardWidget.module.css'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import { SELECTION_SCOPE_ATTR } from '../../../utils/dom-contract'

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
  const colors = tileColors(id, shown)
  const content = (
    <>
      <span className={styles.tileLabel} style={{ color: colors.label }}>
        <DashGlyph name={def.glyph} size={12} color={colors.glyph} />{def.label}
      </span>
      <span className={styles.tileCount} style={{ color: colors.count }} data-testid="dash-tile-count">
        {shown}
        {shown !== total && <span className={styles.of}>of {total}</span>}
      </span>
      <span className={styles.tileSub}>{sub}</span>
      {id === 'open' && data.trend && <Sparkline series={data.trend.openSeries} />}
    </>
  )
  const cls = `${styles.tile} ${styles.surface}`
  const lit = colors.lit ? 'true' : undefined
  if (!onDrill) return <div className={cls} data-dash-tile={id} data-lit={lit} aria-label={`${def.label}: ${countOf(shown, total)}`} role="group">{content}</div>
  return (
    <button
      type="button"
      className={cls}
      data-dash-tile={id}
      data-lit={lit}
      aria-label={`${def.label}: ${countOf(shown, total)}. ${sub ? `${sub}. ` : ''}Show tasks`}
      onClick={() => onDrill(tileDrill(id, data))}
    >
      {content}
      <span className={styles.tileGo}><DashGlyph name="chevron" /></span>
    </button>
  )
}

function ListTiles({ data, onDrill, style }: {
  data: DashboardData
  onDrill?: OnDashboardDrill
  style?: CSSProperties
}) {
  const hints = useListTileHints()
  return (
    <div className={styles.lists} aria-label="List tiles" role="group" style={style}>
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
              description: `List · ${hints.get(t.id) ?? 'All tasks'}`,
              source: { kind: 'list', listDefinitionId: t.id },
            })}
          >
            {content}
          </button>
        ) : (
          <div key={t.id} className={cls} data-dash-list-tile={t.id}>{content}</div>
        )
      })}
    </div>
  )
}

/**
 * The room kept free for the corner gear at the right of the dashboard's
 * first row (the gear's 24px + an 8px gap), so the gear never covers a tile,
 * a number or a section's controls.
 */
const GEAR_SLOT_PX = 32

/** The dashboard's corner gear (shown on hover / focus): opens Customize dashboard. */
function CustomizeGear({ onClick }: { onClick: () => void }) {
  const { triggerProps, tooltip } = useTooltip('Customize dashboard')
  return (
    <button
      type="button"
      className={styles.customizeGear}
      aria-label="Customize dashboard"
      data-dashboard-customize=""
      onClick={onClick}
      {...triggerProps}
    >
      <GearIcon size={14} />
      {tooltip}
    </button>
  )
}

export interface DashboardWidgetProps {
  tab: DashboardTab
  onResult?: (r: DashboardResult) => void
  /** Opens the tasks behind a clicked number; absent = numbers aren't clickable. */
  onDrill?: OnDashboardDrill
  /** Opens Customize from the gear shown on hover / focus; absent = no gear. */
  onCustomize?: () => void
}

/**
 * The Dashboard widget: counts and charts over the open tasks that pass the
 * screen filter, laid out from the tab's config (tiles, list tiles,
 * sections — order and visibility). Built for one cell filling the
 * workspace; below ~1100px of cell width it's one scrolling column.
 */
export function DashboardWidget({ tab, onResult, onDrill: onDrillProp, onCustomize }: DashboardWidgetProps) {
  const config = useMemo(() => normalizeDashboardConfig(tab.config), [tab.config])
  const data = useDashboardData(config)
  // A section divider's width while it is dragged: every task-row section follows it live.
  // (A store, not state: the drag re-renders the row lists, not the widget.)
  const [liveDetailsWidth] = useState(() => createValueStore<number | null>(null))
  // Under the top-bar filter every dialog says it counts only what it shows.
  const onDrill: OnDashboardDrill | undefined = onDrillProp && ((d) => onDrillProp(
    data.filtered ? { ...d, description: withScreenNote(d.description) } : d,
  ))
  const isMobile = useIsMobile()
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const [sizeRef, size] = useElementSize()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const setRootRef = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el
    sizeRef(el)
  }, [sizeRef])
  // Rows sit in sections of their own: read them from the page at click time.
  const { inScope, selectedIds, cursorKey, onSelect } = useWidgetSelection(
    tab.id,
    () => (rootRef.current ? readScopeRows(rootRef.current) : []),
  )

  const countLabel = countOf(data.tiles.shown.open.ids.length, data.tiles.total.open.ids.length)
  const { tags, stale, recent, eisenhower, eisenhowerSetup } = data
  const summary = useMemo(
    () => buildDashboardSummary(config.tiles, data.tiles, data.listTiles, sectionSummaryLines(config.sections, { tags, stale, recent, eisenhower, eisenhowerSetup })),
    [config.tiles, config.sections, data.tiles, data.listTiles, tags, stale, recent, eisenhower, eisenhowerSetup],
  )
  const onResultRef = useLatestRef(onResult)
  useEffect(() => {
    onResultRef.current?.({ countLabel, summary })
  }, [countLabel, summary, onResultRef])

  const rows: DashboardRowKit = {
    tabId: tab.id, isMobile, inScope, selectedIds, cursorKey, onSelect, onOpen: openEditPopup,
    detailsWidth: tab.viewState?.detailsWidth,
    onDetailsWidthChange: (detailsWidth) => void useWorkspaceStore.getState().patchTabViewState(tab.id, 'dashboard', { detailsWidth }),
    liveDetailsWidth,
  }

  const wide = !isMobile && (size.width === 0 || size.width >= DASHBOARD_WIDE_MIN_PX)
  const showLists = data.listTiles.length > 0
  const sectionRows = packSections(config.sections.map((s) => ({ id: s.id, span: DASHBOARD_SECTIONS[s.id].defaultSpan })))
  const optionsOf = new Map(config.sections.map((s) => [s.id, s.options ?? {}]))

  const tracks: string[] = []
  if (config.tiles.length > 0) tracks.push('auto')
  if (showLists) tracks.push('56px')
  tracks.push(...sectionRowTracks(sectionRows.length))

  // The corner gear sits in a slot kept free at the right of the first row:
  // the tiles, else the list tiles, else the first row's last section (the
  // first section when they stack in one column).
  const showGear = onCustomize != null && !isMobile
  const firstSection = wide ? sectionRows[0]?.at(-1)?.id : sectionRows[0]?.[0]?.id
  const gearBeside: 'tiles' | 'lists' | DashboardSectionId | null = !showGear ? null
    : config.tiles.length > 0 ? 'tiles'
    : showLists ? 'lists'
    : firstSection ?? null
  const slot = (id: typeof gearBeside): CSSProperties | undefined => (gearBeside === id ? { marginRight: GEAR_SLOT_PX } : undefined)

  const sections: ReactNode[] = sectionRows.flatMap((row) => row.map((placed) => {
    const { Component } = DASHBOARD_SECTIONS[placed.id]
    return (
      <Component
        key={placed.id}
        data={data}
        options={optionsOf.get(placed.id) ?? {}}
        rows={rows}
        onDrill={onDrill}
        style={wide ? { gridColumn: `span ${placed.span}`, ...slot(placed.id) } : slot(placed.id)}
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
      {...{ [SELECTION_SCOPE_ATTR]: isMobile ? undefined : tab.id }}
    >
      {showGear && onCustomize && <CustomizeGear onClick={onCustomize} />}
      {config.tiles.length > 0 && (
        <div className={styles.tiles} aria-label="Tiles" role="group" data-tile-rows={tileRows} style={slot('tiles')}>
          {config.tiles.map((id) => <Tile key={id} id={id} data={data} onDrill={onDrill} />)}
        </div>
      )}
      {showLists && <ListTiles data={data} onDrill={onDrill} style={slot('lists')} />}
      {sections}
      {showBulkBar && <ListBulkBar ids={[...selectedIds]} bottom={12} />}
    </div>
  )
}
