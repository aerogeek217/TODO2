import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  CHART_NAME_MAX,
} from '../../../models/chart-widgets'
import {
  DEFAULT_TREND_NAME,
  TREND_RANGES,
  TREND_SHOWS,
  trendName,
  trendShow,
  type TrendRange,
  type TrendTabConfig,
} from '../../../models/glance-widgets'
import type { TrendTab } from '../../../models/workspace-layout'
import { trendFilter } from '../../../hooks/use-glance-data'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { getTab } from '../../../utils/workspace-layout-queries'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { ExpressionReportProvider } from '../../shared/filters/expression-report'
import { CloseIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { TREND_SHOW_HINTS, TREND_SHOW_LABELS, trendRangeLabel } from './glance-copy'
import { useEscapeCloses } from './editor-escape'
import { useEditorDraft, usePressElsewhereCloses } from './editor-draft'
import { EditorFooter } from './EditorFooter'
import styles from './ChartEditor.module.css'

/** The Created vs completed tab `tabId` names in the open layout, if it is one. */
function useTrendTab(tabId: string | null): TrendTab | undefined {
  return useWorkspaceStore((s) => {
    const tab = tabId != null && s.working ? getTab(s.working, tabId) : undefined
    return tab?.kind === 'trend' ? tab : undefined
  })
}

/**
 * Created vs completed's open editor (`chart-widgets-store.trendEditorTabId`),
 * under the widget's title (`[data-trend-head]`, found on screen). Hosted by
 * the workspace page outside the widget tree, as the chart editor
 * (`ChartEditorHost`); it closes when the widget leaves the layout or the
 * screen.
 */
export function TrendEditorHost() {
  const tabId = useChartWidgetsStore((s) => s.trendEditorTabId)
  const tab = useTrendTab(tabId)
  const close = useChartWidgetsStore((s) => s.closeTrendEditor)
  // The layout: a change (the tab made active, a row expanded) may bring the widget on screen;
  // the editor's live preview may draw its title anew.
  const working = useWorkspaceStore((s) => s.working)
  const preview = useWidgetPreviewStore((s) => (tabId != null ? s.configs[tabId] : undefined))
  const anchorRef = useRef<HTMLElement | null>(null)
  const [found, setFound] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!tab) return
    // Looked for now, and over the next frames while the widget mounts (a tab just shown).
    let frames = 0
    let raf = 0
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-trend-head="${CSS.escape(tab.id)}"]`)
      anchorRef.current = el
      setFound(el ? tab.id : null)
      if (!el && ++frames < 30) raf = requestAnimationFrame(look)
    }
    look()
    return () => cancelAnimationFrame(raf)
  }, [tab, working, preview])
  useEffect(() => {
    if (tabId != null && !tab) close()
  }, [tabId, tab, close])
  useEffect(() => () => useChartWidgetsStore.getState().closeTrendEditor(), [])
  if (!tab || found !== tab.id) return null
  return <TrendEditor key={tab.id} tab={tab} anchorRef={anchorRef} onClose={close} />
}

/**
 * Created vs completed's editor (the chart editor's pattern): its name, the
 * filter it counts — the Graphical / Expression filter Edit list has, with
 * Reads as —, Show as (Bars, Burndown, Cumulative) and its range. A popover
 * under the widget's title, opened by its ⋯ menu's Edit chart…. Its
 * controls edit a copy of the config, which the widget draws live
 * (`useEditorDraft`): Save writes the changed keys for good as one layout
 * config update — one undo step — and Discard drops them. Esc, × or a press
 * elsewhere close it at once while nothing changed, else ask Save / Discard
 * / Keep editing.
 */
export function TrendEditor({ tab, anchorRef, onClose }: {
  tab: TrendTab
  /** The widget's title it sits under. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const id = useId()
  const storedName = trendName(tab.config)
  const edit = useEditorDraft<TrendTabConfig>({
    tabId: tab.id,
    stored: tab.config,
    write: (p) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'trend', p, `Edited chart “${trendName({ name: p.name ?? tab.config.name })}”`),
    onClose,
    promptTitle: `Save changes to “${storedName}”?`,
  })
  const config = edit.draft
  const patch = edit.patch
  const filter = trendFilter(config)
  const show = trendShow(config)
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    onClose: edit.requestClose,
    placement: 'bottom-start',
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    observeSize: true,
    caret: true,
  })
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const panelEl = useLatestRef(panel)
  useEscapeCloses(panelEl, edit.requestClose)
  usePressElsewhereCloses(panelEl, anchorRef, edit.requestClose)

  // The focus goes back to the widget when it was inside the editor as it closed.
  useEffect(() => () => {
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected || panelEl.current?.contains(active)) {
      anchorRef.current?.closest('section')?.querySelector<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true })
    }
  }, [anchorRef, panelEl])

  const noFilter = !hasFilterClause(filter) && !filter.expression
  return createPortal(
    <PopoverRoot
      ref={(el) => {
        panelRef(el)
        setPanel(el)
      }}
      style={style}
      caret={caret}
      className={styles.editor}
      role="dialog"
      aria-labelledby={`${id}-title`}
      data-trend-editor={tab.id}
    >
      <div className={styles.header}>
        <span id={`${id}-title`} className={styles.title}>Edit chart</span>
        <button type="button" className={styles.close} aria-label="Close" onClick={() => { edit.requestClose() }}><CloseIcon size={14} /></button>
      </div>
      <ExpressionReportProvider value={edit.reportExpression}>
        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input
              type="text"
              className={styles.input}
              value={config.name ?? DEFAULT_TREND_NAME}
              maxLength={CHART_NAME_MAX}
              placeholder={DEFAULT_TREND_NAME}
              autoFocus
              onChange={(e) => patch({ name: e.target.value.slice(0, CHART_NAME_MAX) })}
            />
          </label>
          <div className={styles.fieldset} role="group" aria-labelledby={`${id}-filter`}>
            <span id={`${id}-filter`} className={styles.label}>Count tasks where</span>
            <div className={styles.filter} data-testid="trend-editor-filter">
              <PredicateChips
                predicate={filter}
                onChange={(next) => patch({ filter: next })}
                addLabel="Count tasks where"
                layout="stack"
                inDialog
                before={noFilter ? <span className={styles.noFilter}>No filter — every task</span> : undefined}
              />
            </div>
            <span className={styles.hint}>Among the tasks the top bar shows. Each day counts the tasks the filter kept that day.</span>
          </div>
          <div className={styles.fieldset} role="group" aria-labelledby={`${id}-show`}>
            <span id={`${id}-show`} className={styles.label}>Show as</span>
            <div className={styles.segmented} role="radiogroup" aria-labelledby={`${id}-show`} data-testid="trend-editor-show">
              {TREND_SHOWS.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={show === s}
                  className={styles.segment}
                  onClick={() => patch({ show: s })}
                >
                  {TREND_SHOW_LABELS[s]}
                </button>
              ))}
            </div>
            <span className={styles.hint}>{TREND_SHOW_HINTS[show]}</span>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>Range</span>
            <select className={styles.select} value={config.range} onChange={(e) => patch({ range: e.target.value as TrendRange })}>
              {TREND_RANGES.map((r) => <option key={r} value={r}>{trendRangeLabel(r)}</option>)}
            </select>
          </label>
        </div>
      </ExpressionReportProvider>
      <EditorFooter draft={edit} />
    </PopoverRoot>,
    document.body,
  )
}
