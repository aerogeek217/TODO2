import type { ReactNode } from 'react'
import type { ChartWidgetKind } from '../../../models/workspace-layout'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import { WidgetTopLine } from '../WidgetTopLine'
import { GLANCE_PANEL_CLASS } from './glance-hooks'
import sections from './GlanceSections.module.css'

/**
 * A chart widget's panel (D26 P8): its top line — the split's glyph, its
 * title (where its editor opens, `data-chart-head`), its count (a click
 * opens every task it counts) and a subtitle — over its chart.
 */
export function ChartPanel({ tabId, kind, title, glyph, count, onCount, sub, extras, children }: {
  tabId: string
  kind: ChartWidgetKind
  title: string
  glyph: GlanceGlyphName
  count?: string
  onCount?: () => void
  sub?: string
  extras?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={`${sections.panel} ${GLANCE_PANEL_CLASS}`} aria-label={title} data-glance-section={kind} data-chart={tabId}>
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
