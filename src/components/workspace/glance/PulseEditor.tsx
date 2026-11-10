import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  PULSE_RULE_DEFAULT_NAMES,
  PULSE_RULE_NAME_MAX,
  pulseLateDefaultFilter,
  pulseRuleOf,
  pulseStaleFilterFor,
  type PulseRuleKey,
  type PulseTabConfig,
} from '../../../models/pulse-config'
import type { TodoPredicate } from '../../../models/filter-predicate'
import type { PulseTab } from '../../../models/workspace-layout'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { DEFAULT_STALE_AFTER_DAYS } from '../../../utils/stale'
import { getTab } from '../../../utils/workspace-layout-queries'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { ExpressionReportProvider } from '../../shared/filters/expression-report'
import { CloseIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { useEscapeCloses } from './editor-escape'
import { useEditorDraft, usePressElsewhereCloses } from './editor-draft'
import { EditorFooter } from './EditorFooter'
import styles from './ChartEditor.module.css'

/** The Project pulse tab `tabId` names in the open layout, if it is one. */
function usePulseTab(tabId: string | null): PulseTab | undefined {
  return useWorkspaceStore((s) => {
    const tab = tabId != null && s.working ? getTab(s.working, tabId) : undefined
    return tab?.kind === 'pulse' ? tab : undefined
  })
}

/**
 * Project pulse's open editor (G5, `chart-widgets-store.pulseEditorTabId`),
 * under the widget's title (`[data-pulse-head]`, found on screen; at the
 * small face, the face). Hosted by the workspace page outside the widget
 * tree, as the chart editor (`ChartEditorHost`); it closes when the widget
 * leaves the layout or the screen.
 */
export function PulseEditorHost() {
  const tabId = useChartWidgetsStore((s) => s.pulseEditorTabId)
  const tab = usePulseTab(tabId)
  const close = useChartWidgetsStore((s) => s.closePulseEditor)
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
      const el = document.querySelector<HTMLElement>(`[data-pulse-head="${CSS.escape(tab.id)}"]`)
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
  useEffect(() => () => useChartWidgetsStore.getState().closePulseEditor(), [])
  if (!tab || found !== tab.id) return null
  return <PulseEditor key={tab.id} tab={tab} anchorRef={anchorRef} onClose={close} />
}

/** What each rule's box says it does. */
const RULE_COPY: Record<PulseRuleKey, { title: string; hint: string; addLabel: string }> = {
  late: { title: 'Late', hint: 'A card’s ring is the share of its open tasks this keeps.', addLabel: 'Late when' },
  stale: { title: 'Stale', hint: 'Counted among a card’s open tasks.', addLabel: 'Stale when' },
}

/**
 * One rule's box: its name (as a card's counts read it) and its filter
 * over a card's open tasks. Left as its default, Late shows its default
 * filter (`overdue`) — its first edit writes it as the rule's — and Stale
 * says it follows Settings, with Use a filter (the filter that keeps the
 * same tasks); a filter of its own offers Use the default.
 */
function RuleField({ ruleKey, config, write }: {
  ruleKey: PulseRuleKey
  config: PulseTabConfig
  write: (key: PulseRuleKey, name: string, filter: TodoPredicate | undefined) => void
}) {
  const id = useId()
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const rule = config[ruleKey]
  const name = rule?.name ?? PULSE_RULE_DEFAULT_NAMES[ruleKey]
  const own = rule?.filter
  const copy = RULE_COPY[ruleKey]
  const defaultLink = (
    <button type="button" className={styles.addColumn} onClick={() => write(ruleKey, name, undefined)}>
      {ruleKey === 'stale' ? 'Use the default (follow Settings)' : 'Use the default (overdue)'}
    </button>
  )
  const chips = (filter: TodoPredicate) => (
    <div className={styles.filter}>
      <PredicateChips
        predicate={filter}
        onChange={(next) => write(ruleKey, name, next)}
        addLabel={copy.addLabel}
        layout="stack"
        inDialog
        before={hasFilterClause(filter) || filter.expression ? undefined : <span className={styles.noFilter}>No filter — every open task</span>}
      />
    </div>
  )
  let body
  if (own) {
    body = <>{chips(own)}{defaultLink}</>
  } else if (ruleKey === 'late') {
    body = (
      <>
        <span className={styles.hint}>Default: due before today.</span>
        {chips(pulseLateDefaultFilter())}
      </>
    )
  } else {
    body = (
      <>
        <span className={styles.hint} data-testid="pulse-stale-default">
          {staleAfterDays > 0 ? `Follows Settings: untouched ${staleAfterDays} ${staleAfterDays === 1 ? 'day' : 'days'}` : 'Follows Settings: fading is off, so no task is stale'}
        </span>
        <button
          type="button"
          className={styles.addColumn}
          onClick={() => write(ruleKey, name, pulseStaleFilterFor(staleAfterDays > 0 ? staleAfterDays : DEFAULT_STALE_AFTER_DAYS))}
        >
          Use a filter
        </button>
      </>
    )
  }
  return (
    <div className={styles.column} role="group" aria-labelledby={`${id}-title`} data-pulse-rule={ruleKey}>
      <span id={`${id}-title`} className={styles.label}>{copy.title}</span>
      <span className={styles.hint}>{copy.hint}</span>
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input
          type="text"
          className={styles.input}
          value={name}
          maxLength={PULSE_RULE_NAME_MAX}
          placeholder={PULSE_RULE_DEFAULT_NAMES[ruleKey]}
          aria-label={`${copy.title} name`}
          onChange={(e) => write(ruleKey, e.target.value.slice(0, PULSE_RULE_NAME_MAX), own)}
        />
      </label>
      {body}
    </div>
  )
}

/**
 * Project pulse's editor (G5, the chart editor's pattern): its two rules —
 * what counts as late (a card's ring and late count) and as stale — each
 * a name and a Graphical / Expression filter over a card's open tasks. The
 * tags it follows stay in its ⋯ menu's Tags. A popover under the widget's
 * title, opened by its ⋯ menu's Edit project pulse…. Its controls edit a
 * copy of the config, which the widget draws live (`useEditorDraft`, Edit
 * list's pattern): Save writes the changed rules for good as one layout
 * config update — one undo step — and Discard drops them; Tags, written from the ⋯ menu meanwhile, stay. Esc, × or a
 * press elsewhere close it at once while nothing changed, else ask Save /
 * Discard / Keep editing.
 */
export function PulseEditor({ tab, anchorRef, onClose }: {
  tab: PulseTab
  /** The widget's title it sits under. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const id = useId()
  const edit = useEditorDraft<PulseTabConfig>({
    tabId: tab.id,
    stored: tab.config,
    write: (p) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'pulse', p, 'Edited project pulse'),
    onClose,
    promptTitle: 'Save changes to project pulse?',
  })
  const write = (key: PulseRuleKey, name: string, filter: TodoPredicate | undefined) => {
    edit.patch({ [key]: pulseRuleOf(key, name, filter) })
  }
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
      anchorRef.current?.closest('[data-glance-tab]')?.querySelector<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true })
    }
  }, [anchorRef, panelEl])

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
      data-pulse-editor={tab.id}
    >
      <div className={styles.header}>
        <span id={`${id}-title`} className={styles.title}>Edit project pulse</span>
        <button type="button" className={styles.close} aria-label="Close" onClick={() => { edit.requestClose() }}><CloseIcon size={14} /></button>
      </div>
      <ExpressionReportProvider value={edit.reportExpression}>
        <div className={styles.body}>
          <span className={styles.hint}>Its ⋯ menu’s Tags picks the tags it follows, a card each.</span>
          <RuleField ruleKey="late" config={edit.draft} write={write} />
          <RuleField ruleKey="stale" config={edit.draft} write={write} />
        </div>
      </ExpressionReportProvider>
      <EditorFooter draft={edit} />
    </PopoverRoot>,
    document.body,
  )
}
