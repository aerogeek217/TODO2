import { useEffect, useMemo } from 'react'
import { DEFAULT_STALE_DAYS } from '../../../models/glance-widgets'
import type { StaleTab } from '../../../models/workspace-layout'
import { useStaleRows, useStaleStats, useStatsBase, type ShownOfTotal } from '../../../hooks/use-glance-data'
import { staleTasksDialog } from './glance-drills'
import type { StaleTasks } from '../../../services/stats/stale'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { countOf, staleSubLine } from './glance-copy'
import { glanceDrill, GLANCE_PANEL_CLASS, useGlanceRows, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { staleLine } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import type { TodoLookup } from './section-data'
import { SECTION_META } from './section-meta'
import { Empty, Panel, RowsGrid, TaskRows, type RowSectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Stale tasks reads: its count, its threshold and its rows (a lingering completion kept in place). */
interface StaleSectionData extends TodoLookup {
  stale: ShownOfTotal<StaleTasks>
  staleDays: number
  rows: { stale: readonly number[]; kept: ReadonlySet<number> }
}

/** Stale tasks: open tasks not changed for a while, oldest first, as task rows. */
function StaleSection({ data, rows, onDrill, style, className }: RowSectionProps<StaleSectionData>) {
  const { shown, total } = data.stale
  const days = data.staleDays
  const ids = data.rows.stale
  return (
    <Panel
      def={SECTION_META.stale}
      style={style}
      className={className}
      count={countOf(shown.ids.length, total.ids.length)}
      onCount={onDrill ? () => onDrill(staleTasksDialog(shown.ids, days)) : undefined}
      sub={staleSubLine(days, shown.oldestDays)}
    >
      <div ref={trackScrollEdges} className={styles.panelBody}>
        {ids.length === 0
          ? <Empty title="Nothing stale" hint={`Every open task changed in the last ${days} days.`} />
          : <RowsGrid kit={rows}><TaskRows sectionKey="stale" ids={ids} data={data} kit={rows} kept={data.rows.kept} /></RowsGrid>}
      </div>
    </Panel>
  )
}

/** The Stale tasks widget: the section filling its cell, its rows its own selection. */
export function StaleWidget({ tab, onResult, onDrill }: GlanceWidgetProps<StaleTab>) {
  const staleDays = tab.config.staleDays ?? DEFAULT_STALE_DAYS
  const base = useStatsBase()
  const rows = useGlanceRows(tab)
  const [faceRef, face] = useWidgetFace()
  const stale = useStaleStats(base, staleDays)
  const lingering = useStaleRows(base, stale, staleDays, rows.leaving)
  const { setShown } = rows
  useEffect(() => { setShown(lingering.rows) })
  const lines = useMemo(() => [staleLine({ stale })], [stale])
  useReportLines(onResult, lines)
  const data: StaleSectionData = { stale, staleDays, rows: { stale: lingering.rows, kept: lingering.kept }, todoById: base.todoById }
  return (
    <GlanceFrame tab={tab} rows={rows} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.stale.glyph}
          glyphColor={SECTION_META.stale.glyphColor}
          title={SECTION_META.stale.title}
          value={countOf(stale.shown.ids.length, stale.total.ids.length)}
          caption={`${staleDays}d+ untouched`}
        />
      ) : <StaleSection
        data={data}
        rows={rows.kit}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
