import { useEffect, useMemo } from 'react'
import type { GlanceTab } from '../../../models/workspace-layout'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { withScreenNote } from './glance-copy'
import { summaryOf, type GlanceSummary, type SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import styles from './GlanceWidget.module.css'

/** What a glance widget reports to its cell: its lines, for the tab menu's Copy. */
export interface GlanceResult {
  summary: GlanceSummary
}

export interface GlanceWidgetProps<T extends GlanceTab> {
  tab: T
  onResult?: (result: GlanceResult) => void
  /** Opens the tasks behind a clicked number; absent = numbers aren't clickable. */
  onDrill?: OnGlanceDrill
}

/** The class a section panel takes as a glance widget: no card, filling the cell. */
export const GLANCE_PANEL_CLASS = styles.panel

/** `onDrill`, its dialogs saying they count only what the top bar shows while the screen filter narrows. */
export function glanceDrill(onDrill: OnGlanceDrill | undefined, filtered: boolean): OnGlanceDrill | undefined {
  return onDrill && ((d) => onDrill(filtered ? { ...d, description: withScreenNote(d.description) } : d))
}

/** Reports the widget's lines (`summaryOf`) to its cell whenever they change. */
export function useReportLines(onResult: ((r: GlanceResult) => void) | undefined, lines: readonly SummaryPart[][]): void {
  const summary = useMemo(() => summaryOf(lines), [lines])
  const onResultRef = useLatestRef(onResult)
  useEffect(() => {
    onResultRef.current?.({ summary })
  }, [summary, onResultRef])
}
