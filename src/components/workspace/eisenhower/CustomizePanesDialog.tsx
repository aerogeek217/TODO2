import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { TodoPredicate } from '../../../models'
import type { EisenhowerQuadrant, EisenhowerTab, WorkspaceLayout } from '../../../models/workspace-layout'
import { usePaneContext } from '../../../hooks/use-pane-context'
import { useEqualValue } from '../../../hooks/use-equal-value'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { classifyPanes } from '../../../utils/eisenhower'
import {
  paneSubtitle,
  QUADRANT_COLOR,
  QUADRANT_NAME,
  resolvePanes,
  samePaneFilters,
  withPaneConfig,
  type EisenhowerPane,
} from '../../../utils/eisenhower-panes'
import { filterChips, type FilterChipNames } from '../../../utils/filter-chips'
import { getTab } from '../../../utils/workspace-layout-ops'
import { DialogFrame } from '../../shared/Dialog'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { CloseIcon } from '../../shared/icons'
import { useEisenhowerSource } from './use-eisenhower-source'
import styles from './CustomizePanesDialog.module.css'

/** The menu item (tab menu, cell menu) that opens the dialog. */
export const CUSTOMIZE_PANES_LABEL = 'Customize panes…'

/** The Eisenhower tab `tabId` of the working layout, if it's still there. */
function eisenhowerTabOf(layout: WorkspaceLayout | null, tabId: string): EisenhowerTab | null {
  if (!layout) return null
  const tab = getTab(layout, tabId)
  return tab?.kind === 'eisenhower' ? tab : null
}

export interface CustomizePanesDialogProps {
  tabId: string
  /** Opened from a pane's header menu: that pane's name field takes the focus. */
  focusPane?: EisenhowerQuadrant
  onClose: () => void
}

/**
 * Customize panes (a standard dialog): the four panes as a 2×2 of cards —
 * each with its name, its filter as the list filter chips (+ Filter adds a
 * clause), how many open tasks it holds now and Reset pane — then how many
 * open tasks are in no pane, and Reset all. Every change is written to the
 * tab's config at once — it shows behind the dialog and makes the layout
 * unsaved (Save / Discard is the undo).
 */
export function CustomizePanesDialog({ tabId, focusPane, onClose }: CustomizePanesDialogProps) {
  const tab = useWorkspaceStore((s) => eisenhowerTabOf(s.working, tabId))
  useEffect(() => {
    if (!tab) onClose()
  }, [tab, onClose])
  if (!tab) return null
  return <PanesPanel tab={tab} focusPane={focusPane} onClose={onClose} />
}

function PanesPanel({ tab, focusPane, onClose }: { tab: EisenhowerTab; focusPane?: EisenhowerQuadrant; onClose: () => void }) {
  const titleId = useId()
  const source = useEisenhowerSource(tab)
  const paneCtx = usePaneContext()
  const names = useChipNames()
  const panes = useMemo(() => resolvePanes(tab.config.panes), [tab.config.panes])
  const shown = source.kind === 'tasks' ? source.shown : NO_TASKS
  // Classified again only when a filter changes (not on each keystroke of a rename).
  const sortingPanes = useEqualValue(panes, samePaneFilters)
  const { byPane, none } = useMemo(() => classifyPanes(shown, sortingPanes, paneCtx), [shown, sortingPanes, paneCtx])
  const noneOpen = none.filter((t) => !t.isCompleted).length
  const focusRef = useRef<HTMLInputElement>(null)

  const patchPane = (q: EisenhowerQuadrant, patch: Parameters<typeof withPaneConfig>[2]) => {
    // Read the config as it is now: two quick edits mustn't drop one another.
    const current = eisenhowerTabOf(useWorkspaceStore.getState().working, tab.id)?.config.panes
    useWorkspaceStore.getState().patchTabConfig(tab.id, 'eisenhower', { panes: withPaneConfig(current, q, patch) })
  }
  const anyCustom = panes.some((p) => p.customName || p.customFilter)

  return (
    <DialogFrame
      onClose={onClose}
      layer="overlay"
      initialFocus={focusPane ? focusRef : 'panel'}
      aria-labelledby={titleId}
      className={styles.dialog}
      data={{ 'customize-panes': tab.id }}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>Customize panes</h2>
        <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}><CloseIcon size={12} /></button>
      </div>
      <p className={styles.sub}>
        A task shows in the first pane whose filter it matches, checked in order: top left, top right, bottom left,
        bottom right. Dropping a task on a pane gives it what the filter sets. Changes are saved with the layout.
      </p>
      <div className={styles.grid}>
        {panes.map((pane) => (
          <PaneCard
            key={pane.id}
            pane={pane}
            names={names}
            count={byPane[pane.id].filter((t) => !t.isCompleted).length}
            inputRef={pane.id === focusPane ? focusRef : undefined}
            onRename={(name) => patchPane(pane.id, { name })}
            onFilter={(filter) => patchPane(pane.id, { filter })}
            onReset={() => patchPane(pane.id, null)}
          />
        ))}
      </div>
      <p className={styles.noPane} data-testid="customize-panes-no-pane">
        {noneOpen === 0
          ? 'Every open task is in a pane.'
          : `${noneOpen} open ${noneOpen === 1 ? 'task is' : 'tasks are'} in no pane — hidden from the matrix, counted under it.`}
      </p>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={!anyCustom}
          onClick={() => useWorkspaceStore.getState().patchTabConfig(tab.id, 'eisenhower', { panes: undefined })}
        >
          Reset all
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.primaryBtn} onClick={onClose}>Done</button>
      </div>
    </DialogFrame>
  )
}

const NO_TASKS: never[] = []

interface PaneCardProps {
  pane: EisenhowerPane
  names: FilterChipNames
  /** Open tasks in the pane now. */
  count: number
  inputRef?: RefObject<HTMLInputElement | null>
  onRename: (name: string) => void
  onFilter: (filter: TodoPredicate) => void
  onReset: () => void
}

/** One pane: its name, its filter as chips, its count now, Reset pane. */
function PaneCard({ pane, names, count, inputRef, onRename, onFilter, onReset }: PaneCardProps) {
  const nameId = useId()
  // The field keeps what is typed (spaces included); the pane stores it trimmed.
  const stored = pane.customName ? pane.name : ''
  const [name, setName] = useState(stored)
  // A change from elsewhere (Reset pane, Reset all) shows in the field.
  const [syncedFrom, setSyncedFrom] = useState(stored)
  if (syncedFrom !== stored) {
    setSyncedFrom(stored)
    if (name.trim() !== stored) setName(stored)
  }
  const hasChips = useMemo(() => filterChips(pane.filter, names).length > 0, [pane.filter, names])
  const subtitle = useMemo(() => paneSubtitle(pane, names), [pane, names])
  return (
    <section
      className={styles.card}
      data-pane-card={pane.id}
      aria-label={`${pane.name} pane`}
      style={{ '--pane-color': QUADRANT_COLOR[pane.id] } as CSSProperties}
    >
      <div className={styles.cardHead}>
        <label htmlFor={nameId} className={styles.nameLabel}>Name</label>
        <input
          ref={inputRef}
          id={nameId}
          className={styles.nameInput}
          value={name}
          placeholder={QUADRANT_NAME[pane.id]}
          onChange={(e) => {
            setName(e.target.value)
            onRename(e.target.value)
          }}
        />
        <span
          className={styles.count}
          data-testid="customize-pane-count"
          role="img"
          aria-label={`${count} open ${count === 1 ? 'task' : 'tasks'} now`}
        >
          {count} now
        </span>
      </div>
      <div className={styles.chips} data-testid="customize-pane-filter">
        <PredicateChips
          predicate={pane.filter}
          onChange={onFilter}
          addLabel="Add a filter to this pane"
          inDialog
          before={hasChips ? undefined : <span className={styles.noFilter}>No filter — every task</span>}
        />
      </div>
      <div className={styles.cardFoot}>
        <span className={styles.subtitle}>{subtitle}</span>
        <button
          type="button"
          className={styles.resetBtn}
          disabled={!pane.customName && !pane.customFilter}
          onClick={onReset}
        >
          Reset pane
        </button>
      </div>
    </section>
  )
}
