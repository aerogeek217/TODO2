import { useEffect, useMemo } from 'react'
import { DEFAULT_LOOK_AHEAD } from '../../../models/glance-widgets'
import type { FollowupTab } from '../../../models/workspace-layout'
import { followupRowIds, useFollowupRows, useFollowupStats, useStatsBase, type ShownOfTotal } from '../../../hooks/use-glance-data'
import type { FollowupGroups } from '../../../services/stats/followup-groups'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { countOf } from './glance-copy'
import { followupDrill } from './glance-drills'
import { GLANCE_PANEL_CLASS, glanceDrill, useGlanceRows, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { followupLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { GlanceSmallFace } from './GlanceSmallFace'
import type { TodoLookup } from './section-data'
import { SECTION_META } from './section-meta'
import { Empty, Panel, RowsGrid, TaskRows, type RowSectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Needs follow-up reads: its groups, and its rows (a lingering completion kept in place). */
export interface FollowupSectionData extends TodoLookup {
  followup: ShownOfTotal<FollowupGroups>
  rows: { followup: FollowupGroups; kept: ReadonlySet<number> }
}

/** Needs follow-up: open tasks whose next follow-up is late, today or in the next few days, as task rows by group. */
export function FollowupSection({ data, options, rows, onDrill, style, className }: RowSectionProps<FollowupSectionData>) {
  const lookAhead = options.lookAhead ?? DEFAULT_LOOK_AHEAD
  const { shown, total } = data.followup
  const groupsOf = (g: typeof shown) => [
    { key: 'fu-late', name: 'Late', dot: 'var(--color-followup)', ids: g.late },
    { key: 'fu-today', name: 'Today', dot: 'var(--color-followup)', ids: g.today },
    { key: 'fu-next', name: `Next ${lookAhead} days`, dot: 'var(--color-text-muted)', ids: g.upcoming },
  ].filter((group) => group.ids.length > 0)
  const groups = groupsOf(shown)
  // The rows: a just-completed task lingers in its group (D19).
  const rowGroups = groupsOf(data.rows.followup)
  const shownCount = shown.late.length + shown.today.length + shown.upcoming.length
  const totalCount = total.late.length + total.today.length + total.upcoming.length
  return (
    <Panel
      def={SECTION_META.followup}
      style={style}
      className={className}
      count={countOf(shownCount, totalCount)}
      onCount={onDrill
        ? () => onDrill(followupDrill(lookAhead, groups.map((g) => ({ key: g.key, label: g.name, color: g.dot, todoIds: g.ids }))))
        : undefined}
      sub={`Late, today and the next ${lookAhead} days`}
    >
      <div ref={trackScrollEdges} className={styles.panelBody}>
        {rowGroups.length === 0 ? (
          <Empty
            title="Nothing needs follow-up"
            hint={`No follow-ups are late, due today or due in the next ${lookAhead} days.`}
          />
        ) : (
          <RowsGrid kit={rows}>
            {rowGroups.map((g) => (
              <div key={g.key} className={styles.group} role="group" aria-label={g.name} data-row-group="">
                <div className={styles.groupHeader}>
                  <i className={styles.groupDot} style={{ background: g.dot }} />
                  <span className={styles.groupName}>{g.name}</span>
                  <span className={styles.groupCount}>{g.ids.length}</span>
                  <span className={styles.groupRule} aria-hidden="true" />
                </div>
                <TaskRows sectionKey={g.key} ids={g.ids} data={data} kit={rows} kept={data.rows.kept} />
              </div>
            ))}
          </RowsGrid>
        )}
      </div>
    </Panel>
  )
}

/** The Needs follow-up widget: the section filling its cell, its rows its own selection. */
export function FollowupWidget({ tab, onResult, onDrill }: GlanceWidgetProps<FollowupTab>) {
  const { lookAhead } = tab.config
  const base = useStatsBase()
  const rows = useGlanceRows(tab)
  const [faceRef, face] = useWidgetFace()
  const followup = useFollowupStats(base, lookAhead)
  const lingering = useFollowupRows(base, followup, lookAhead, rows.leaving)
  const { setShown } = rows
  useEffect(() => { setShown(followupRowIds(lingering.rows)) })
  const lines = useMemo(() => followupLines(followup, lookAhead), [followup, lookAhead])
  useReportLines(onResult, lines)
  const data: FollowupSectionData = { followup, rows: { followup: lingering.rows, kept: lingering.kept }, todoById: base.todoById }
  const late = followup.shown.late.length
  return (
    <GlanceFrame tab={tab} rows={rows} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.followup.glyph}
          glyphColor={SECTION_META.followup.glyphColor}
          title={SECTION_META.followup.title}
          value={String(late)}
          valueColor={late > 0 ? 'var(--color-followup)' : 'var(--color-text-muted)'}
          caption="late"
        />
      ) : <FollowupSection
        data={data}
        options={{ lookAhead }}
        rows={rows.kit}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
