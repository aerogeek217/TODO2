import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  BREAKDOWN_COLUMNS_MAX,
  BREAKDOWN_OLDEST_BY,
  BREAKDOWN_SHOWS,
  BREAKDOWN_SPLITS,
  BREAKDOWN_STYLES,
  CHART_NAME_MAX,
  DEFAULT_BREAKDOWN_OLDEST_BY,
  breakdownColumns,
  newBreakdownColumnId,
  type BreakdownColumn,
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
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { isInLayerAbove } from '../../../utils/dom-layers'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { HUE_PRESET_HEX } from '../../../utils/layout-hue'
import { emptyPredicate } from '../../../models/filter-predicate'
import { getTab } from '../../../utils/workspace-layout-queries'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { CloseIcon, PlusIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { ColorPicker } from '../../shared/ColorPicker'
import { LitWhenControl } from './LitWhenField'
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
  return <ChartEditor key={tab.id} tab={tab} anchorRef={anchorRef} onClose={close} />
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

/** A new count column's colour: the first preset hue none of `columns` has (else teal). */
function freshColor(columns: readonly BreakdownColumn[]): string {
  const used = new Set(columns.map((c) => c.color.toLowerCase()))
  return Object.values(HUE_PRESET_HEX).find((hex) => !used.has(hex.toLowerCase())) ?? HUE_PRESET_HEX.teal
}

/**
 * A Breakdown's **Count columns** (board BC): each a name, a colour, when
 * its count fills solid (Light up when, a Number's rule) and a filter
 * (Graphical / Expression), × to remove it; + Add column, up to
 * `BREAKDOWN_COLUMNS_MAX`. A config without `columns` shows the ones read
 * from its old ranges (`breakdownColumns`); the first edit writes them all
 * as `columns` and drops the old `badges`.
 */
function CountColumnsField({ config, patch }: { config: BreakdownConfig; patch: (p: Partial<BreakdownConfig>) => void }) {
  const id = useId()
  const appRanges = useSettingsStore((s) => s.tabBadges)
  const columns = breakdownColumns(config, appRanges)
  const write = (next: BreakdownColumn[]) => patch({ columns: next, badges: undefined })
  const set = (i: number, column: BreakdownColumn) => write(columns.map((c, j) => (j === i ? column : c)))
  return (
    <div className={styles.fieldset} role="group" aria-labelledby={`${id}-columns`} data-testid="chart-editor-columns">
      <span id={`${id}-columns`} className={styles.label}>Count columns</span>
      {columns.length === 0 && <span className={styles.hint}>No count columns: each row shows its {config.show === 'oldest' ? 'oldest task' : 'open tasks'} and priority.</span>}
      {columns.map((column, i) => {
        const label = column.name.trim() || `Column ${i + 1}`
        return (
          <div key={column.id} className={styles.column} role="group" aria-label={`Count column ${i + 1}`} data-column-editor={column.id}>
            <div className={styles.columnHead}>
              <span className={styles.columnSwatch} style={{ background: column.color }} aria-hidden="true" />
              <input
                type="text"
                className={styles.input}
                value={column.name}
                maxLength={CHART_NAME_MAX}
                placeholder="Column"
                aria-label={`Column ${i + 1} name`}
                onChange={(e) => set(i, { ...column, name: e.target.value.slice(0, CHART_NAME_MAX) })}
              />
              <button type="button" className={styles.close} aria-label={`Remove ${label}`} title="Remove" onClick={() => write(columns.filter((_, j) => j !== i))}>
                <CloseIcon size={12} />
              </button>
            </div>
            <ColorPicker value={column.color} onChange={(color) => set(i, { ...column, color })} />
            <div className={styles.columnRow}>
              <span>Light up when</span>
              <LitWhenControl
                litWhen={column.litWhen}
                litAt={column.litAt}
                label={`${label}: light up when`}
                onChange={({ litWhen, litAt }) => {
                  const { litAt: _old, ...rest } = column
                  void _old
                  set(i, litAt === undefined ? { ...rest, litWhen } : { ...rest, litWhen, litAt })
                }}
              />
            </div>
            <div className={styles.filter}>
              <PredicateChips
                predicate={column.filter}
                onChange={(filter) => set(i, { ...column, filter })}
                addLabel="Count tasks where"
                layout="stack"
                inDialog
                before={hasFilterClause(column.filter) || column.filter.expression ? undefined : <span className={styles.noFilter}>No filter — every open task in the row</span>}
              />
            </div>
          </div>
        )
      })}
      {columns.length < BREAKDOWN_COLUMNS_MAX && (
        <button
          type="button"
          className={styles.addColumn}
          onClick={() => write([...columns, {
            id: newBreakdownColumnId(columns),
            name: `Count ${columns.length + 1}`,
            color: freshColor(columns),
            filter: emptyPredicate(),
            litWhen: 'above',
            litAt: 0,
          }])}
        >
          <PlusIcon size={12} /> Add column
        </button>
      )}
    </div>
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
        fields: (
          <>
            <BreakdownFields config={tab.config} patch={(p) => ws().patchTabConfig(tab.id, 'breakdown', p)} />
            <CountColumnsField config={tab.config} patch={(p) => ws().patchTabConfig(tab.id, 'breakdown', p)} />
          </>
        ),
      }
    case 'pivot':
      return {
        title: 'Edit pivot',
        filterLabel: 'Split tasks where',
        fields: <PivotFields config={tab.config} patch={(p) => ws().patchTabConfig(tab.id, 'pivot', p)} />,
      }
    case 'tagMap':
      return {
        title: 'Edit tag map',
        filterLabel: 'Open tasks where',
        fields: <span className={styles.hint}>Its ⋯ menu’s Tags picks the tags it maps; Every tag by default.</span>,
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
export function ChartEditor({ tab, anchorRef, onClose }: {
  tab: ChartTab
  /** The chart's title it sits under. */
  anchorRef: RefObject<HTMLElement | null>
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
            autoFocus
            onChange={(e) => patch({ name: e.target.value.slice(0, CHART_NAME_MAX) })}
          />
        </label>
        <div className={styles.fieldset} role="group" aria-labelledby={`${id}-filter`}>
          <span id={`${id}-filter`} className={styles.label}>{filterLabel}</span>
          <div className={styles.filter} data-testid="chart-editor-filter">
            <PredicateChips
              predicate={config.filter}
              onChange={(filter) => patch({ filter })}
              addLabel={filterLabel}
              layout="stack"
              inDialog
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
