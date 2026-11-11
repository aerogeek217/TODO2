import { useMemo, type MouseEvent } from 'react'
import { DEFAULT_STATUS_ICON } from '../../../models'
import { DEFAULT_NUMBER_BREAKDOWN } from '../../../models/glance-widgets'
import type { NumberTab } from '../../../models/workspace-layout'
import { useNumberCount, useNumberHistory, useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { PRIORITY_GROUP_RINGS } from '../../../services/stats/breakdown'
import { historyDelta } from '../../../services/stats/number-count'
import { numberBreakdown, type BreakdownEntry } from '../../../services/stats/number-breakdown'
import { useChipNames } from '../../shared/filters/filter-menu'
import { PriorityRing } from '../../shared/PriorityRing'
import { StatusIcon } from '../../shared/StatusIcon'
import { approximateNote, countOf, deltaLabel, numberDescription } from './glance-copy'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { numberLines } from './glance-summary'
import { breakdownDrill, numberDrill, type NumberBreakdownBy } from './glance-drills'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { WidgetTopLine } from '../WidgetTopLine'
import { Sparkline } from './Sparkline'
import { numberColors } from './number-colors'
import { GoalNumber, GroupNumber, ListNumber, OldestNumber, ShareNumber } from './NumberShapes'
import styles from './NumberWidget.module.css'

/** The large face's breakdown lists this many lines; the rest fold into one line. */
export const BREAKDOWN_SHOWN = 5

/** The breakdown's list name: `Overdue by person`. */
const BY_WORDS: Record<NumberBreakdownBy, string> = { people: 'person', tags: 'tag', status: 'status', priority: 'priority' }

/** What leads a breakdown line: a status's glyph, a priority group's ring (as on a task's checkbox), else a dot in its colour. */
function EntryMark({ entry }: { entry: BreakdownEntry }) {
  const mark = entry.mark
  if (mark?.kind === 'status') {
    return <span className={styles.breakdownMark} style={{ color: entry.color }} aria-hidden="true"><StatusIcon icon={mark.icon ?? DEFAULT_STATUS_ICON} filled /></span>
  }
  if (mark?.kind === 'priority') {
    return (
      <span className={styles.breakdownRing} aria-hidden="true" data-priority={mark.group}>
        <span className={styles.breakdownRingBorder} />
        <PriorityRing summary={PRIORITY_GROUP_RINGS[mark.group]} completed={false} size={14} />
      </span>
    )
  }
  return <i className={styles.breakdownDot} style={{ background: entry.color ?? 'var(--color-text-muted)' }} aria-hidden="true" />
}

/**
 * The large face's breakdown: a line per person / tag / status / priority
 * group with a bar of its share and its count (each opens its tasks), the
 * rest as `N more`.
 */
function Breakdown({ entries, by, total, title, onDrill }: {
  entries: readonly BreakdownEntry[]
  by: NumberBreakdownBy
  total: number
  title: string
  onDrill?: OnGlanceDrill
}) {
  if (entries.length === 0) return null
  const shown = entries.slice(0, BREAKDOWN_SHOWN)
  const rest = entries.length - shown.length
  const max = Math.max(1, ...shown.map((e) => e.ids.length))
  return (
    <div className={styles.breakdown} role="list" aria-label={`${title} by ${BY_WORDS[by]}`} data-testid="number-breakdown">
      {shown.map((e) => {
        const content = (
          <>
            <EntryMark entry={e} />
            <span className={styles.breakdownName}>{e.label}</span>
            <span className={styles.breakdownBar} aria-hidden="true"><span style={{ width: `${Math.round((e.ids.length / max) * 100)}%` }} /></span>
            <span className={styles.breakdownCount}>{e.ids.length}</span>
          </>
        )
        const label = `${e.label}: ${e.ids.length} of ${total}`
        return onDrill ? (
          <button
            key={e.key}
            type="button"
            role="listitem"
            className={styles.breakdownRow}
            data-breakdown={e.key}
            aria-label={`${label}. Show tasks`}
            onClick={() => onDrill(breakdownDrill(title, by, e))}
          >
            {content}
          </button>
        ) : (
          <div key={e.key} role="listitem" className={styles.breakdownRow} data-breakdown={e.key} aria-label={label}>{content}</div>
        )
      })}
      {rest > 0 && <span className={styles.breakdownMore}>{rest} more</span>}
    </div>
  )
}

/**
 * The Number widget: its shape's widget (D26 P6, `show`) — the count, or one
 * of the other shapes (`NumberShapes`).
 */
export function NumberWidget(props: GlanceWidgetProps<NumberTab>) {
  switch (props.tab.config.show) {
    case 'count': return <CountNumber {...props} />
    case 'share': return <ShareNumber {...props} />
    case 'oldest': return <OldestNumber {...props} />
    case 'goal': return <GoalNumber {...props} />
    case 'group': return <GroupNumber {...props} />
    case 'list': return <ListNumber {...props} />
  }
}

/**
 * A count (D26 P5): the tasks its filter keeps under the top
 * bar's filter (its lens too, unless the Number ignores it), as their count
 * — `shown of total` while the top bar hides some, with its 14-day line
 * (`filter-history`, ≈ when the history log doesn't hold all it reads for
 * the whole line) and its change against yesterday or the same day last
 * week (`compare`) beside the count wherever they fit (widget feedback 2D:
 * by the room, not the face — in a fit row too; the change goes first, then
 * the line; `.figures`). By its face (D25 R): small and medium are the name
 * over the count (a fit row's, 58px); large draws it bigger and adds the
 * breakdown its config picks (by person, tag, status or priority). Lit in its colour while
 * its count crosses its threshold (D18, `litWhen`). A click opens its
 * tasks, at every face. Its editor (Edit number…, `NumberEditorHost`)
 * opens beside its body (`data-number-body`).
 */
function CountNumber({ tab, onResult, onDrill }: GlanceWidgetProps<NumberTab>) {
  const config = tab.config
  const breakdownBy = config.breakdown ?? DEFAULT_NUMBER_BREAKDOWN
  const base = useStatsBase()
  const count = useNumberCount(base, config)
  const history = useNumberHistory(base, count)
  const names = useChipNames()
  const [faceRef, face] = useWidgetFace()

  const name = config.name.trim() || 'Number'
  const shownIds = count.ids.shown
  const shown = shownIds.length
  const total = count.ids.total.length
  const large = face === 'large'
  // The line is drawn at every face; it shows where it fits beside the count (`.figures` drops it otherwise).
  const series = history ? history.series : null
  const delta = history && config.compare !== 'none' ? historyDelta(history.series, config.compare) : null
  const deltaText = delta == null || config.compare === 'none' ? null : deltaLabel(delta, config.compare, base.ctx.today)
  const approximate = history != null && !history.exactness.exact ? approximateNote(history.exactness.approximate) : null
  const colors = numberColors(config, shown)
  const countText = countOf(shown, total)
  const breakdown = useMemo(
    () => (large ? numberBreakdown(shownIds, breakdownBy, base.ctx, base.todoById) : []),
    [large, shownIds, breakdownBy, base.ctx, base.todoById],
  )

  const lines = useMemo(() => numberLines(name, countText, deltaText ?? ''), [name, countText, deltaText])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, count.filtered)
  const content = (
    <>
      <WidgetTopLine as="span" controls="cell" className={styles.label} style={{ color: colors.label }}>
        <span className={styles.labelText}>{name}</span>
      </WidgetTopLine>
      <span className={styles.figures}>
        <span className={styles.count} style={{ color: colors.count }} data-testid="number-count">
          {shown}
          {shown !== total && <span className={styles.of}>of {total}</span>}
        </span>
        {series && (
          <span className={styles.history}>
            <Sparkline series={series} width={large ? 120 : 64} height={large ? 36 : 22} className={styles.spark} />
            {(deltaText != null || approximate) && (
              <span className={styles.delta} data-testid="number-delta">
                {approximate && <span className={styles.approx} title={approximate} data-testid="number-approximate">≈ </span>}
                {deltaText}
              </span>
            )}
          </span>
        )}
      </span>
    </>
  )
  const label = `${name}: ${countText}.${deltaText != null ? ` ${approximate ? 'About ' : ''}${deltaText}.` : ''}`
  const common = {
    className: `${styles.number}${large ? ` ${styles.large}` : ''}`,
    'data-number': tab.id,
    'data-show': 'count',
    'data-lit': colors.lit ? 'true' : undefined,
  }
  const open = (e: MouseEvent) => {
    // Its own drill: not the cell's full-widget popover.
    e.preventDefault()
    drill?.(numberDrill(name, numberDescription(config.filter, names), shownIds))
  }
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      <div data-number-body={tab.id} className={`${styles.body}${large && breakdown.length > 0 ? ` ${styles.bodyWithBreakdown}` : ''}`}>
        {drill ? (
          <button type="button" {...common} aria-label={`${label} Show tasks`} onClick={open}>
            {content}
          </button>
        ) : (
          <div {...common} role="group" aria-label={label}>{content}</div>
        )}
        {large && breakdownBy !== 'none' && <Breakdown entries={breakdown} by={breakdownBy} total={shown} title={name} onDrill={drill} />}
      </div>
    </GlanceFrame>
  )
}
