import { useMemo } from 'react'
import { DEFAULT_RECENT_DAYS } from '../../../models/glance-widgets'
import type { RecentTab } from '../../../models/workspace-layout'
import { useRecentStats, useStatsBase, type ShownOfTotal } from '../../../hooks/use-glance-data'
import { recentlyCompletedDialog } from '../../../services/task-dialog'
import type { RecentlyCompleted } from '../../../services/stats/recently-completed'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { countOf } from './glance-copy'
import { glanceDrill, GLANCE_PANEL_CLASS, useGlanceRows, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { recentLine } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import type { TodoLookup } from './section-data'
import { SECTION_META } from './section-meta'
import { Empty, Panel, RowsGrid, TaskRows, type RowSectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Recently completed reads. */
export interface RecentSectionData extends TodoLookup {
  recent: ShownOfTotal<RecentlyCompleted>
  recentDays: number
}

/** Recently completed: tasks completed in the last few days, newest first, as task rows. */
export function RecentSection({ data, rows, onDrill, style, className }: RowSectionProps<RecentSectionData>) {
  const { shown, total } = data.recent
  const days = data.recentDays
  const ids = shown.ids
  return (
    <Panel
      def={SECTION_META.recent}
      style={style}
      className={className}
      count={countOf(ids.length, total.ids.length)}
      onCount={onDrill ? () => onDrill(recentlyCompletedDialog(ids, days)) : undefined}
      sub={`Last ${days} days`}
    >
      <div ref={trackScrollEdges} className={styles.panelBody}>
        {ids.length === 0
          ? <Empty title="Nothing completed" hint={`Tasks completed in the last ${days} days show here.`} />
          : <RowsGrid kit={rows}><TaskRows sectionKey="recent" ids={ids} data={data} kit={rows} /></RowsGrid>}
      </div>
    </Panel>
  )
}

/** The Recently completed widget: the section filling its cell, its rows its own selection. */
export function RecentWidget({ tab, onResult, onDrill }: GlanceWidgetProps<RecentTab>) {
  const recentDays = tab.config.recentDays ?? DEFAULT_RECENT_DAYS
  const base = useStatsBase()
  const rows = useGlanceRows(tab)
  const [faceRef, face] = useWidgetFace()
  const recent = useRecentStats(base, recentDays)
  const lines = useMemo(() => [recentLine({ recent })], [recent])
  useReportLines(onResult, lines)
  return (
    <GlanceFrame tab={tab} rows={rows} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.recent.glyph}
          glyphColor={SECTION_META.recent.glyphColor}
          title={SECTION_META.recent.title}
          value={countOf(recent.shown.ids.length, recent.total.ids.length)}
          caption={`in ${recentDays} days`}
        />
      ) : <RecentSection
        data={{ recent, recentDays, todoById: base.todoById }}
        options={{ recentDays }}
        rows={rows.kit}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
