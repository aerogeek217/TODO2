import { useEffect, useId, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { plannerUnplannedFilter, type LayoutTab, type PlannerTab, type PlannerTabConfig } from '../../../models/workspace-layout'
import { useEscapeCloses, usePressElsewhereCloses } from '../../../hooks/use-close-events'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { usePlannerStore } from '../../../stores/planner-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { DialogCloseButton } from '../../shared/DialogCloseButton'
import { ExpressionReportProvider } from '../../shared/filters/expression-report'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { useEditorDraft, widgetEditorElsewhere } from '../glance/editor-draft'
import { EditorFooter } from '../glance/EditorFooter'
import { WidgetEditorHost } from '../glance/WidgetEditorHost'
import styles from '../glance/ChartEditor.module.css'

/** What the Planner settings open beside: the filter line under Unplanned, else the folded trays' bar, else the widget. */
const ANCHORS = ['data-planner-filter-line', 'data-planner-dock-bar-anchor', 'data-planner'] as const

/** The open Planner settings (`planner-store.settingsTabId`), hosted on the workspace page outside the widget tree. */
export function PlannerSettingsHost() {
  const tabId = usePlannerStore((s) => s.settingsTabId)
  const close = usePlannerStore((s) => s.closeSettings)
  return <WidgetEditorHost tabId={tabId} isKind={isPlannerTab} anchor={ANCHORS} close={close} Editor={PlannerSettings} />
}

const isPlannerTab = (tab: LayoutTab): tab is PlannerTab => tab.kind === 'planner'

/**
 * The **Planner settings** (board E): **Unplanned holds** — the filter an
 * open task with no day matches to join Unplanned on its own, in the
 * Number editor's filter field (Graphical / Expression, Reads as, Syntax…) —
 * and what it means. A widget editor (`useEditorDraft`): the Planner draws
 * the filter as edited, Save writes it as one layout config update — one
 * undo step —, Cancel drops it; Esc, × or a press elsewhere close it at once
 * while nothing changed, else ask Save / Discard / Keep editing. A Planner
 * that never set a filter shows Focus (`plannerUnplannedFilter`); an empty
 * one means nothing joins on its own.
 */
function PlannerSettings({ tab, anchorRef, onClose }: {
  tab: PlannerTab
  /** The filter line (or the widget) it opens beside. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const id = useId()
  const edit = useEditorDraft<PlannerTabConfig>({
    tabId: tab.id,
    stored: { unplanned: plannerUnplannedFilter(tab.config) },
    write: (p) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'planner', p, 'Changed what counts as unplanned'),
    onClose,
    promptTitle: 'Save changes to the Planner?',
  })
  const filter = plannerUnplannedFilter(edit.draft)
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
  useEscapeCloses(panelEl, edit.requestClose, { leaveLayersAbove: true })
  usePressElsewhereCloses((t) => widgetEditorElsewhere(t, panelEl.current, anchorRef.current), edit.requestClose)

  // The focus goes back to what opened it — the filter line, else the widget — when it was inside as it closed.
  useEffect(() => () => {
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected || panelEl.current?.contains(active)) {
      const anchor = anchorRef.current
      const target = anchor?.matches('button') ? anchor : anchor?.querySelector<HTMLElement>('button, [tabindex]')
      target?.focus({ preventScroll: true })
    }
  }, [anchorRef, panelEl])

  const empty = !hasFilterClause(filter) && !filter.expression
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
      aria-label="Planner settings"
      data-planner-settings={tab.id}
    >
      <div className={styles.header}>
        <span className={styles.title}>Planner</span>
        <DialogCloseButton size={24} onClick={() => { edit.requestClose() }} />
      </div>
      <ExpressionReportProvider value={edit.reportExpression}>
        <div className={styles.body}>
          <div className={styles.fieldset} role="group" aria-labelledby={`${id}-unplanned`}>
            <span id={`${id}-unplanned`} className={styles.label}>Unplanned holds</span>
            <div className={styles.filter} data-testid="planner-settings-filter">
              <PredicateChips
                predicate={filter}
                onChange={(unplanned) => edit.patch({ unplanned })}
                addLabel="Unplanned holds"
                layout="stack"
                inDialog
                before={empty ? <span className={styles.noFilter}>No filter — nothing joins on its own</span> : undefined}
              />
            </div>
            <span className={styles.hint}>An open task with no day that matches joins Unplanned on its own. Empty, nothing joins on its own: only what you unplan.</span>
          </div>
        </div>
      </ExpressionReportProvider>
      <EditorFooter draft={edit} discardLabel="Cancel" />
    </PopoverRoot>,
    document.body,
  )
}
