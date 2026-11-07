import { useMemo } from 'react'
import { EISENHOWER_QUADRANTS, type EisenhowerSummaryTab } from '../../../models/workspace-layout'
import { useEisenhowerStats, useStatsBase, type EisenhowerSetup, type ShownOfTotal } from '../../../hooks/use-glance-data'
import type { EisenhowerSummary } from '../../../services/stats/eisenhower-summary'
import type { StatsContext } from '../../../services/stats/stats-context'
import { eisenhowerQuadrantDialog, eisenhowerSummaryDialog } from '../../../services/task-dialog'
import { paneSubtitle, QUADRANT_COLOR } from '../../../utils/eisenhower-panes'
import { useChipNames } from '../../shared/filters/filter-menu'
import { countOf } from './glance-copy'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { eisenhowerLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { SECTION_META } from './section-meta'
import { Clickable, Panel, type SectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What the Eisenhower summary reads. */
export interface EisenhowerSectionData {
  eisenhower: ShownOfTotal<EisenhowerSummary>
  eisenhowerSetup: EisenhowerSetup
  ctx: StatsContext
}

/** The Eisenhower summary: the app-wide panes' counts, a 2×2 in the quadrants' tints. */
export function EisenhowerSection({ data, onDrill, style, className }: SectionProps<EisenhowerSectionData>) {
  const { shown, total } = data.eisenhower
  const { panes, listName } = data.eisenhowerSetup
  const names = useChipNames()
  const subtitles = useMemo(() => panes.map((p) => paneSubtitle(p, names)), [panes, names])
  const source = { urgentRange: data.ctx.urgentRange, listName }
  const sum = (s: typeof shown) => EISENHOWER_QUADRANTS.reduce((n, q) => n + s[q].ids.length, 0)
  const custom = panes.some((p) => p.customFilter)
  const sub = [listName != null ? `“${listName}”` : null, custom ? 'Custom panes' : 'Urgent × important'].filter((x) => x != null).join(' · ')
  return (
    <Panel
      def={SECTION_META.eisenhower}
      style={style}
      className={className}
      count={`${countOf(sum(shown), sum(total))} open`}
      onCount={onDrill ? () => onDrill(eisenhowerSummaryDialog(panes, {
        do: shown.do.ids, schedule: shown.schedule.ids, delegate: shown.delegate.ids, drop: shown.drop.ids,
      }, source)) : undefined}
      sub={sub}
    >
      <div className={styles.matrix} data-eis-matrix="">
        {panes.map((pane, i) => {
          const q = pane.id
          const n = shown[q].ids.length
          const t = total[q].ids.length
          const byDate = shown[q].byDate
          const subtitle = subtitles[i] ?? ''
          return (
            <Clickable
              key={q}
              as="div"
              className={styles.quadrant}
              data-eis-cell={q}
              label={`${pane.name}, ${subtitle.toLowerCase()}: ${countOf(n, t)}. Show tasks`}
              onClick={onDrill && n > 0 ? () => onDrill(eisenhowerQuadrantDialog(pane, subtitle, shown[q].ids, source)) : undefined}
            >
              <span className={styles.quadrantName} style={{ color: QUADRANT_COLOR[q] }}>{pane.name}</span>
              <span className={styles.quadrantSub}>{subtitle}</span>
              <span className={styles.quadrantCount} style={{ color: n === 0 ? 'var(--color-text-muted)' : undefined }} data-testid="dash-eis-count">
                {n}
                {n !== t && <span className={styles.of}>of {t}</span>}
              </span>
              {byDate > 0 && <span className={styles.quadrantSub}>{byDate} by due date</span>}
            </Clickable>
          )
        })}
      </div>
    </Panel>
  )
}

/** The Eisenhower summary widget: the section filling its cell. */
export function EisenhowerSummaryWidget({ tab, onResult, onDrill }: GlanceWidgetProps<EisenhowerSummaryTab>) {
  const base = useStatsBase()
  const { eisenhower, eisenhowerSetup } = useEisenhowerStats(base)
  const lines = useMemo(() => eisenhowerLines({ eisenhower, eisenhowerSetup }), [eisenhower, eisenhowerSetup])
  useReportLines(onResult, lines)
  return (
    <GlanceFrame tab={tab}>
      <EisenhowerSection
        data={{ eisenhower, eisenhowerSetup, ctx: base.ctx }}
        options={{}}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />
    </GlanceFrame>
  )
}
