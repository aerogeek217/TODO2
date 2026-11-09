import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  BREAKDOWN_OLDEST_BY,
  BREAKDOWN_SHOWS,
  BREAKDOWN_SPLITS,
  BREAKDOWN_STYLES,
  CHART_NAME_MAX,
  DEFAULT_BREAKDOWN_OLDEST_BY,
  type BreakdownConfig,
  type BreakdownOldestBy,
  type BreakdownShow,
  type BreakdownSplit,
  type BreakdownStyle,
  type PivotConfig,
  type PivotDim,
} from '../../../models/chart-widgets'
import { isChartTab, type ChartTab } from '../../../models/workspace-layout'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { NONE_ROW_LABELS } from '../../../services/stats/breakdown'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import type { ListFilterField } from '../../../stores/list-widget-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { isInLayerAbove } from '../../../utils/dom-layers'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { getTab } from '../../../utils/workspace-layout-queries'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { CloseIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { OLDEST_BY_LABELS, SHOW_LABELS, SPLIT_CHOICE_LABELS, STYLE_LABELS } from './breakdown-copy'
import styles from './ChartEditor.module.css'

/** A key that landed on the page itself: nothing is focused. */
function isPageTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target === document.body || target === document.documentElement
}

/**
 * Esc closes the editor when it comes from inside it (or with nothing
 * focused) and nothing inside handled it first — a filter picker, the
 * expression field putting its text back. Bubble phase, after those (as
 * the Number editor's).
 */
function useEscapeCloses(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useLatestRef(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = panel.current
      const inside = el != null && e.target instanceof Node && el.contains(e.target)
      if (!inside && !isPageTarget(e.target)) return
      if (el && e.target instanceof Node && isInLayerAbove(el, e.target)) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel, onCloseRef])
}

/** The chart tab `tabId` names in the open layout, if it is one. */
function useChartTab(tabId: string | null): ChartTab | undefined {
  return useWorkspaceStore((s) => {
    const tab = tabId != null && s.working ? getTab(s.working, tabId) : undefined
    return tab && isChartTab(tab) ? tab : undefined
  })
}

/**
 * The open chart editor (`chart-widgets-store.editorTabId`), under its
 * chart's title (`[data-chart-head]`, found on screen). Hosted by the
 * workspace page, outside the widget tree, so no key or press in it reaches
 * the cell's handlers (React events bubble through portals) — as the
 * Number editor. It closes when the chart leaves the layout or the screen.
 */
export function ChartEditorHost() {
  const tabId = useChartWidgetsStore((s) => s.editorTabId)
  const startField = useChartWidgetsStore((s) => s.editorStartField)
  const tab = useChartTab(tabId)
  const close = useChartWidgetsStore((s) => s.closeEditor)
  // The layout: a change (the tab made active, a row expanded) may bring the chart on screen.
  const working = useWorkspaceStore((s) => s.working)
  const anchorRef = useRef<HTMLElement | null>(null)
  const [found, setFound] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!tab) return
    // Looked for now, and over the next frames while the chart mounts (a new one, a tab just shown).
    let frames = 0
    let raf = 0
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-chart-head="${CSS.escape(tab.id)}"]`)
      anchorRef.current = el
      setFound(el ? tab.id : null)
      if (!el && ++frames < 30) raf = requestAnimationFrame(look)
    }
    look()
    return () => cancelAnimationFrame(raf)
  }, [tab, working])
  useEffect(() => {
    if (tabId != null && !tab) close()
  }, [tabId, tab, close])
  useEffect(() => () => useChartWidgetsStore.getState().closeEditor(), [])
  if (!tab || found !== tab.id) return null
  return <ChartEditor key={tab.id} tab={tab} anchorRef={anchorRef} startField={startField ?? undefined} onClose={close} />
}

function Select<V extends string>({ label, value, options, labels, onChange }: {
  label: string
  value: V
  options: readonly V[]
  labels: Record<V, string>
  onChange: (v: V) => void
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select className={styles.select} value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map((o) => <option key={o} value={o}>{labels[o]}</option>)}
      </select>
    </label>
  )
}

/** A Breakdown's own fields: split by, style, show (and the date `oldest` reads), the none row, the check-ins. */
function BreakdownFields({ config, patch }: { config: BreakdownConfig; patch: (p: Partial<BreakdownConfig>) => void }) {
  const noneLabel = NONE_ROW_LABELS[config.splitBy]
  return (
    <>
      <div className={styles.grid}>
        <Select<BreakdownSplit>
          label="Split by"
          value={config.splitBy}
          options={BREAKDOWN_SPLITS}
          labels={SPLIT_CHOICE_LABELS}
          onChange={(splitBy) => patch(splitBy === 'people' ? { splitBy } : { splitBy, checkins: undefined })}
        />
        <Select<BreakdownStyle> label="Style" value={config.style} options={BREAKDOWN_STYLES} labels={STYLE_LABELS} onChange={(style) => patch({ style })} />
        <Select<BreakdownShow>
          label="Show"
          value={config.show}
          options={BREAKDOWN_SHOWS}
          labels={SHOW_LABELS}
          onChange={(show) => patch(show === 'oldest' ? { show, oldestBy: config.oldestBy ?? DEFAULT_BREAKDOWN_OLDEST_BY } : { show, oldestBy: undefined })}
        />
        {config.show === 'oldest' && (
          <Select<BreakdownOldestBy>
            label="Oldest by"
            value={config.oldestBy ?? DEFAULT_BREAKDOWN_OLDEST_BY}
            options={BREAKDOWN_OLDEST_BY}
            labels={OLDEST_BY_LABELS}
            onChange={(oldestBy) => patch({ oldestBy })}
          />
        )}
      </div>
      <div className={styles.checks}>
        {config.splitBy !== 'age' && (
          <label className={styles.check}>
            <input type="checkbox" checked={config.showNone} onChange={(e) => patch({ showNone: e.target.checked })} />
            {`Show ${noneLabel}`}
          </label>
        )}
        {config.splitBy === 'people' && (
          <label className={styles.check}>
            <input type="checkbox" checked={config.checkins === true} onChange={(e) => patch({ checkins: e.target.checked ? true : undefined })} />
            Check-in envelope on each person
          </label>
        )}
      </div>
    </>
  )
}

/** A Pivot's own fields: what its rows and its columns split by. */
function PivotFields({ config, patch }: { config: PivotConfig; patch: (p: Partial<PivotConfig>) => void }) {
  return (
    <div className={styles.grid}>
      <Select<PivotDim> label="Rows" value={config.rows} options={BREAKDOWN_SPLITS} labels={SPLIT_CHOICE_LABELS} onChange={(rows) => patch({ rows })} />
      <Select<PivotDim> label="Columns" value={config.cols} options={BREAKDOWN_SPLITS} labels={SPLIT_CHOICE_LABELS} onChange={(cols) => patch({ cols })} />
    </div>
  )
}

/** What each chart kind's editor is titled, its filter's label and its own fields (a case per chart kind). */
function kindParts(tab: ChartTab): { title: string; filterLabel: string; fields: ReactNode } {
  const ws = useWorkspaceStore.getState
  switch (tab.kind) {
    case 'breakdown':
      return {
        title: 'Edit breakdown',
        filterLabel: 'Split tasks where',
        fields: <BreakdownFields config={tab.config} patch={(p) => ws().patchTabConfig(tab.id, 'breakdown', p)} />,
      }
    case 'pivot':
      return {
        title: 'Edit pivot',
        filterLabel: 'Split tasks where',
        fields: <PivotFields config={tab.config} patch={(p) => ws().patchTabConfig(tab.id, 'pivot', p)} />,
      }
  }
}

/**
 * A chart's editor (D26 P8, the Number editor's pattern, board X): its
 * name, the filter it splits — the Graphical / Expression filter Edit list
 * has, with Reads as — and its kind's own fields (a Breakdown's split,
 * style and what it shows). A popover under the chart's title, opened by
 * its ⋯ menu's Edit … and straight after Add widget. Every control writes
 * the tab's config at once — layout config, so the layout is unsaved
 * until Save. Esc, × or a press elsewhere close it.
 */
export function ChartEditor({ tab, anchorRef, startField, onClose }: {
  tab: ChartTab
  /** The chart's title it sits under. */
  anchorRef: RefObject<HTMLElement | null>
  /** A filter field whose picker opens at once (Waiting on with no Waiting status). */
  startField?: ListFilterField
  onClose: () => void
}) {
  const config = tab.config
  const id = useId()
  /** The fields every chart has: its name and its filter. */
  const patch = (p: { name?: string; filter?: ChartTab['config']['filter'] }) => useWorkspaceStore.getState().patchTabConfig(tab.id, tab.kind, p)
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    onClose,
    placement: 'bottom-start',
    closeOnScroll: 'user',
    closeOnResize: false,
    closeOnEscape: false,
    observeSize: true,
    caret: true,
  })
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const panelEl = useLatestRef(panel)
  useEscapeCloses(panelEl, onClose)

  // The focus goes back to the chart when it was inside the editor as it closed.
  useEffect(() => () => {
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected || panelEl.current?.contains(active)) {
      anchorRef.current?.closest('section')?.querySelector<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true })
    }
  }, [anchorRef, panelEl])

  const { title, filterLabel, fields } = kindParts(tab)
  const noFilter = !hasFilterClause(config.filter) && !config.filter.expression
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
      data-chart-editor={tab.id}
    >
      <div className={styles.header}>
        <span id={`${id}-title`} className={styles.title}>{title}</span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}><CloseIcon size={14} /></button>
      </div>
      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            type="text"
            className={styles.input}
            value={config.name}
            maxLength={CHART_NAME_MAX}
            placeholder="Name"
            autoFocus={!startField}
            onChange={(e) => patch({ name: e.target.value.slice(0, CHART_NAME_MAX) })}
          />
        </label>
        <div className={styles.fieldset} role="group" aria-labelledby={`${id}-filter`}>
          <span id={`${id}-filter`} className={styles.label}>{filterLabel}</span>
          <div className={styles.filter} data-testid="chart-editor-filter">
            {startField && noFilter && (
              <span className={styles.hint} data-testid="chart-editor-pick-hint">No status is named Waiting: pick the one you wait on.</span>
            )}
            <PredicateChips
              predicate={config.filter}
              onChange={(filter) => patch({ filter })}
              addLabel={filterLabel}
              layout="stack"
              inDialog
              startPicking={startField}
              before={noFilter ? <span className={styles.noFilter}>No filter — every open task</span> : undefined}
            />
          </div>
        </div>
        {fields}
      </div>
    </PopoverRoot>,
    document.body,
  )
}
