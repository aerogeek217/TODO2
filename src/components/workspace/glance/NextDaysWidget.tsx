import { useMemo } from 'react'
import type { Next7Tab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { useNextDays, useStatsBase } from '../../../hooks/use-glance-data'
import type { NextDaysColumn } from '../../../services/stats/next-seven-days'
import type { StatsContext } from '../../../services/stats/stats-context'
import { DashGlyph } from '../../shared/DashGlyph'
import { nextDayDialogWords, nextDayLabels } from './glance-copy'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { nextDaysLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { nextDaysCount } from './glance-face'
import { GlanceSmallFace } from './GlanceSmallFace'
import { SECTION_META } from './section-meta'
import { Clickable, Legend, Panel, type SectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Next 7 days reads. */
export interface NextDaysSectionData {
  nextDays: NextDaysColumn[]
  ctx: StatsContext
}

/** Px per task in the Next 7 days bars, when they fit. */
const DAY_UNIT_PX = 22
/** Counts row + labels + gaps + padding around the bars in a column. */
const DAY_CHROME_PX = 80

/** Next 7 days: due dates and follow-ups per day, late first, as bars. */
export function NextDaysSection({ data, onDrill, style, className }: SectionProps<NextDaysSectionData>) {
  const [ref, size] = useElementSize()
  const cols = data.nextDays
  const tallest = Math.max(1, ...cols.map((c) => c.dueIds.length + c.followupIds.length))
  const room = Math.max(0, size.height - DAY_CHROME_PX)
  const unit = size.height > 0 ? Math.min(DAY_UNIT_PX, room / tallest) : DAY_UNIT_PX
  return (
    <Panel
      def={SECTION_META.next7}
      style={style}
      className={className}
      extras={<><Legend color="var(--color-overdue)" label="Due" glyph="calendar" /><Legend color="var(--color-followup)" label="Follow-up" glyph="followup" /></>}
    >
      <div ref={ref} className={styles.days}>
        {cols.map((c, i) => {
          const [name, num] = nextDayLabels(c.date, i)
          const d = c.dueIds.length
          const f = c.followupIds.length
          const words = nextDayDialogWords(c.date, i, data.ctx.today)
          return (
            <Clickable
              key={i}
              as="div"
              className={styles.day}
              data-late={i === 0 ? 'true' : undefined}
              data-today={i === 1 ? 'true' : undefined}
              data-testid="dash-day"
              label={`${name} ${num}: ${d} due, ${f} follow-up. Show tasks`}
              onClick={onDrill ? () => onDrill({
                ...words,
                glyph: 'calendar',
                source: {
                  kind: 'groups',
                  groups: [
                    { key: 'due', label: 'Due', color: 'var(--color-overdue)', todoIds: c.dueIds },
                    { key: 'followup', label: 'Follow-up', color: 'var(--color-followup)', todoIds: c.followupIds },
                  ],
                },
              }) : undefined}
            >
              <span className={styles.dayCounts}>
                {d + f === 0 && <span className={styles.muted}>–</span>}
                {/* Each count with its glyph, so due and follow-up don't rest on colour alone. */}
                {d > 0 && <span className={styles.dayCount} data-count="due" style={{ color: 'var(--color-overdue)' }}><DashGlyph name="calendar" size={10} />{d}</span>}
                {f > 0 && <span className={styles.dayCount} data-count="followup" style={{ color: 'var(--color-followup)' }}><DashGlyph name="followup" size={10} />{f}</span>}
              </span>
              <span className={styles.dayBars}>
                {d > 0 && <span className={styles.bar} style={{ height: d * unit, background: 'var(--color-overdue)' }} />}
                {f > 0 && <span className={styles.bar} style={{ height: f * unit, background: 'var(--color-followup)' }} />}
              </span>
              <span className={styles.dayLabels}>
                <span className={styles.dayName}>{name}</span>
                <span className={styles.dayNum}>{num}</span>
              </span>
            </Clickable>
          )
        })}
      </div>
    </Panel>
  )
}

/** `Late`, `Today 10`, `Sun 11`: a column's label in the copied lines. */
function columnLabel(date: Date | null, i: number): string {
  const [name, num] = nextDayLabels(date, i)
  return date == null ? name : `${name} ${num}`
}

/** The Next 7 days widget: the section filling its cell. */
export function NextDaysWidget({ tab, onResult, onDrill }: GlanceWidgetProps<Next7Tab>) {
  const base = useStatsBase()
  const nextDays = useNextDays(base)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => nextDaysLines(nextDays, columnLabel), [nextDays])
  useReportLines(onResult, lines)
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.next7.glyph}
          glyphColor={SECTION_META.next7.glyphColor}
          title={SECTION_META.next7.title}
          value={String(nextDaysCount(nextDays))}
          caption="due or follow-up"
        />
      ) : <NextDaysSection
        data={{ nextDays, ctx: base.ctx }}
        options={{}}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
