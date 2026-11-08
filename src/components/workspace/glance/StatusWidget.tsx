import { useMemo } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { StatusTab } from '../../../models/workspace-layout'
import { useStatsBase, useStatusStats, type ShownOfTotal } from '../../../hooks/use-glance-data'
import type { StatusBreakdownEntry } from '../../../services/stats/status-breakdown'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { trackScrollEdges } from '../../../utils/scroll-edges'
import { StatusIcon } from '../../shared/StatusIcon'
import { countOf } from './glance-copy'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { statusLines } from './glance-summary'
import { GlanceFrame } from './GlanceFrame'
import { topStatus } from './glance-face'
import { GlanceSmallFace } from './GlanceSmallFace'
import { openIds } from './section-data'
import { SECTION_META } from './section-meta'
import { Clickable, Empty, Panel, type SectionProps } from './section-parts'
import styles from './GlanceSections.module.css'

/** What Status reads: the breakdown, and the tasks it counts (for its drills). */
export interface StatusSectionData {
  status: ShownOfTotal<StatusBreakdownEntry[]>
  shown: readonly PersistedTodoItem[]
}

/** Status: the open tasks by status, as a bar and a row per status. */
export function StatusSection({ data, onDrill, style, className }: SectionProps<StatusSectionData>) {
  const entries = data.status.shown
  const open = entries.reduce((n, e) => n + e.count, 0)
  const openTotal = data.status.total.reduce((n, e) => n + e.count, 0)
  return (
    <Panel
      def={SECTION_META.status}
      style={style}
      className={className}
      count={`${countOf(open, openTotal)} open`}
      onCount={onDrill ? () => onDrill({
        title: 'Open tasks',
        glyph: 'status',
        description: 'Open tasks by status.',
        source: {
          kind: 'groups',
          groups: entries.filter((e) => e.count > 0).map((e) => ({
            key: String(e.id ?? 'none'),
            label: e.label,
            color: e.color,
            todoIds: openIds(data.shown, (t) => (t.statusId ?? null) === e.id),
          })),
        },
      }) : undefined}
    >
      {openTotal === 0 ? (
        <Empty title="No open tasks" hint="Open tasks show here by status." />
      ) : (
        <>
          <div className={styles.statusBar} role="img" aria-label={`${open} open tasks by status`}>
            {entries.filter((e) => e.count > 0).map((e) => (
              <span key={e.id ?? 'none'} style={{ flex: `${e.count} 1 0`, background: e.color }} />
            ))}
          </div>
          <div ref={trackScrollEdges} className={styles.panelBody}>
            {entries.map((e) => (
              <Clickable
                key={e.id ?? 'none'}
                as="div"
                className={styles.statusRow}
                data-zero={e.count === 0 ? 'true' : undefined}
                data-status-key={String(e.id ?? 'unset')}
                label={`${e.label}: ${e.count}. Show tasks`}
                onClick={onDrill && e.count > 0
                  ? () => onDrill({
                    title: e.label,
                    glyph: 'status',
                    description: e.id == null ? 'Open tasks with no status.' : `Status: ${e.label}.`,
                    source: { kind: 'todos', todoIds: openIds(data.shown, (t) => (t.statusId ?? null) === e.id) },
                  })
                  : undefined}
              >
                <span style={{ color: e.color, display: 'inline-flex' }}><StatusIcon icon={e.icon} filled /></span>
                <span className={styles.statusName}>{e.label}</span>
                <span className={styles.statusCount}>{e.count}</span>
                <span className={styles.statusPct}>{open > 0 ? Math.round((e.count / open) * 100) : 0}%</span>
              </Clickable>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/** The Status widget: the section filling its cell. */
export function StatusWidget({ tab, onResult, onDrill }: GlanceWidgetProps<StatusTab>) {
  const base = useStatsBase()
  const status = useStatusStats(base)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => statusLines(status), [status])
  useReportLines(onResult, lines)
  const top = topStatus(status.shown)
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      {face === 'small' ? (
        <GlanceSmallFace
          glyph={SECTION_META.status.glyph}
          glyphColor={SECTION_META.status.glyphColor}
          title={SECTION_META.status.title}
          entry={top?.label}
          value={String(top?.count ?? 0)}
          valueColor={top ? top.color : 'var(--color-text-muted)'}
          caption={top ? undefined : 'open'}
        />
      ) : <StatusSection
        data={{ status, shown: base.shown }}
        options={{}}
        onDrill={glanceDrill(onDrill, base.filtered)}
        className={GLANCE_PANEL_CLASS}
      />}
    </GlanceFrame>
  )
}
