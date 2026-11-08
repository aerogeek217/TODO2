import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FollowupTab, GlanceTab, RecentTab, StaleTab, TodayTab } from '../../../models/workspace-layout'
import { useIsMobile } from '../../../hooks/use-is-mobile'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useLeavingRows, type LeavingRows } from '../../../hooks/use-leaving-rows'
import { useWidgetSelection } from '../../../hooks/use-widget-selection'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { readScopeRows } from '../../../utils/scoped-selection'
import { createValueStore } from '../../../utils/value-store'
import { withScreenNote } from './glance-copy'
import { summaryOf, type GlanceSummary, type SummaryPart } from './glance-summary'
import type { GlanceRowKit, OnGlanceDrill } from './glance-types'
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

type RowsTab = FollowupTab | StaleTab | RecentTab | TodayTab

/** A row widget's rows: their selection scope, columns, lingering completions and bulk bar. */
export interface GlanceRows {
  kit: GlanceRowKit
  /** Just-completed rows lingering before they fold (D19; desktop), for the rows' data. */
  leaving: LeavingRows | undefined
  /** Call with the task ids the widget shows, each render: a completion among them lingers. */
  setShown: (ids: readonly number[]) => void
  /** The widget's root: its rows are read from it at click time. */
  rootRef: (el: HTMLDivElement | null) => void
  isMobile: boolean
  /** The bulk bar shows (two or more selected here). */
  bulkIds: number[] | null
}

/**
 * The task rows of a row widget (Needs follow-up, Stale tasks, Recently
 * completed, Today): its own selection scope (its tab id) and bulk bar; the
 * rows' details width is the tab's view state.
 */
export function useGlanceRows(tab: RowsTab): GlanceRows {
  const isMobile = useIsMobile()
  const shownRef = useRef<ReadonlySet<number>>(new Set())
  const leaving = useLeavingRows((id) => shownRef.current.has(id))
  const setShown = useCallback((ids: readonly number[]) => { shownRef.current = new Set(ids) }, [])
  // A divider's width while it is dragged (a store: the drag re-renders the rows, not the widget).
  const [liveDetailsWidth] = useState(() => createValueStore<number | null>(null))
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const elRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useCallback((el: HTMLDivElement | null) => { elRef.current = el }, [])
  const { inScope, selectedIds, cursorKey, onSelect } = useWidgetSelection(
    tab.id,
    () => (elRef.current ? readScopeRows(elRef.current) : []),
  )
  const kit: GlanceRowKit = {
    tabId: tab.id, isMobile, inScope, selectedIds, cursorKey, onSelect, onOpen: openEditPopup,
    detailsWidth: tab.viewState?.detailsWidth,
    onDetailsWidthChange: (detailsWidth) => void useWorkspaceStore.getState().patchTabViewState(tab.id, tab.kind, { detailsWidth }),
    liveDetailsWidth,
    leaving: isMobile ? undefined : leaving,
  }
  return {
    kit,
    leaving: isMobile ? undefined : leaving,
    setShown,
    rootRef,
    isMobile,
    bulkIds: !isMobile && inScope && selectedIds.size >= 2 ? [...selectedIds] : null,
  }
}
