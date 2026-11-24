import type { ReactNode } from 'react'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import { WidgetTopLine } from '../WidgetTopLine'
import { GLANCE_PANEL_CLASS } from './glance-hooks'
import sections from './GlanceSections.module.css'

/**
 * A Breakdown's panel (D26 P8): its top line — the split's glyph, its
 * title (where its editor opens, `data-chart-head`), its count (a click
 * opens every task it counts) and a subtitle — over its chart.
 */
export function ChartPanel({ tabId, title, glyph, count, onCount, sub, extras, children }: {
  tabId: string
  title: string
  glyph: GlanceGlyphName
  count?: string
  onCount?: () => void
  sub?: string
  extras?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={`${sections.panel} ${GLANCE_PANEL_CLASS}`} aria-label={title} data-glance-section="breakdown" data-chart={tabId}>
      <WidgetTopLine className={sections.panelHeader}>
        <GlanceGlyph name={glyph} color="var(--color-accent)" />
        <span className={sections.panelTitle} data-chart-head={tabId}>{title}</span>
        {count != null && (onCount
          ? (
            <button
              type="button"
              className={`${sections.panelCount} ${sections.panelCountBtn}`}
              data-testid="glance-section-count"
              aria-label={`${title}: ${count}. Show tasks`}
              onClick={onCount}
            >
              {count}
            </button>
          )
          : <span className={sections.panelCount} data-testid="glance-section-count">{count}</span>)}
        {sub && <span className={sections.panelSub} data-testid="chart-sub">{sub}</span>}
        {extras && <span className={sections.panelExtras}>{extras}</span>}
      </WidgetTopLine>
      {children}
    </section>
  )
}

/**
 * A Breakdown table's sortable heading (item 8): a
 * button — a click sorts the rows by it, counts largest first and names A–Z,
 * a second reverses (`reversed`) — with ▼ / ▲ while it is the sort
 * (`active`). The widget styles it (`classes`).
 */
export function SortHeading({ by, label, title, active, reversed, onSort, className, classes, data }: {
  by: string
  label: string
  title?: string
  active: boolean
  reversed: boolean
  onSort: (by: string) => void
  className: string | undefined
  classes: { button: string | undefined; label: string | undefined; mark: string | undefined }
  /** Data attributes on the heading. */
  data?: Record<`data-${string}`, string>
}) {
  // Counts go largest first, names A–Z; a second click reverses.
  const descending = by === 'name' ? reversed : !reversed
  return (
    <span role="columnheader" className={className} aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'} {...data}>
      <button type="button" className={classes.button} data-sort-key={by} aria-pressed={active} data-tooltip={title} onClick={() => onSort(by)}>
        <span className={classes.label}>{label}</span>
        {active && <span className={classes.mark} aria-hidden="true">{descending ? '▼' : '▲'}</span>}
      </button>
    </span>
  )
}
