import { useId, useMemo, useState, type CSSProperties } from 'react'
import type { TodoPredicate } from '../../../models'
import type { EisenhowerQuadrant } from '../../../models/workspace-layout'
import { usePaneContext } from '../../../hooks/use-pane-context'
import { useEqualValue } from '../../../hooks/use-equal-value'
import { useEisenhowerSource } from '../../../hooks/use-eisenhower-source'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import { eisenhowerPaneFocus } from '../../../stores/ui-store'
import { countActiveFilters } from '../../../utils/filter-criteria'
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
import { predicateLineItems, type FilterChipNames } from '../../../utils/filter-chips'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { ConfirmDialog } from '../../shared/Dialog'
import { ListFilterRow } from '../../workspace/list/ListFilterRow'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import sectionStyles from './sections.module.css'
import styles from './EisenhowerSection.module.css'

/** Saves pane `q`'s settings patched (`null` = reset), from the panes as they are now (two quick edits mustn't drop one another). */
function patchPane(q: EisenhowerQuadrant, patch: Parameters<typeof withPaneConfig>[2], description: string, mergeKey?: string): void {
  const store = useSettingsStore.getState()
  void store.setEisenhowerPanes(withPaneConfig(store.eisenhowerPanes, q, patch), description, mergeKey)
}

/**
 * Settings › Tasks › Eisenhower: what every Eisenhower (and the dashboard's
 * Eisenhower section) considers — the Eisenhower's own list, its filter as
 * the filter line every Eisenhower shows (`ListFilterRow`: the same list and
 * unsaved edits, Revert · Save while unsaved) — and its four
 * panes as a 2×2 of cards: each with its name, its filter as the list filter
 * chips (+ Filter adds a clause), how many open tasks it holds now (the
 * screen filter applied, as in the widget) and Reset pane; then how many
 * open tasks are in no pane, and Reset all panes (asked first). Every change
 * is saved at once as one undo step (a name typed in one go is one); all but
 * a typed name show the undo snackbar — the place to undo while Settings is
 * open. While a screen filter narrows the counts, a line says so. Desktop
 * only.
 */
export function EisenhowerSection() {
  const source = useEisenhowerSource()
  const paneCtx = usePaneContext()
  const names = useChipNames()
  const storedPanes = useSettingsStore((s) => s.eisenhowerPanes)
  const panes = useMemo(() => resolvePanes(storedPanes), [storedPanes])
  const shown = source.shown
  // Classified again only when a filter changes (not on each keystroke of a rename).
  const sortingPanes = useEqualValue(panes, samePaneFilters)
  const { byPane, none } = useMemo(() => classifyPanes(shown, sortingPanes, paneCtx), [shown, sortingPanes, paneCtx])
  const noneOpen = none.filter((t) => !t.isCompleted).length
  const anyCustom = panes.some((p) => p.customName || p.customFilter)
  // Completed tasks aren't counted, so showing them narrows nothing here.
  const screenFilters = useFilterStore((s) => countActiveFilters({ ...s.filters, showCompleted: false }))
  const [confirmReset, setConfirmReset] = useState(false)
  useStackedLayer(confirmReset)

  return (
    <div className={sectionStyles.section}>
      <SettingRow
        label="Tasks"
        help="What every Eisenhower and the dashboard sort into the panes: the Eisenhower’s own list. No filter = every task."
        column
      >
        {source.list && (
          <div className={styles.listLine} data-testid="eisenhower-list-line">
            <ListFilterRow definition={source.list.definition} summary={false} inDialog />
          </div>
        )}
      </SettingRow>
      <p className={styles.intro}>
        A task shows in the first pane whose filter it matches, checked in order: top left, top right, bottom left,
        bottom right. Dropping a task on a pane gives it what the filter sets. The panes are the same in every
        Eisenhower and on the dashboard; changes are saved at once.
      </p>
      <div className={styles.grid}>
        {panes.map((pane) => (
          <PaneCard
            key={pane.id}
            pane={pane}
            names={names}
            count={byPane[pane.id].filter((t) => !t.isCompleted).length}
            onRename={(name) => patchPane(pane.id, { name }, `Renamed pane “${QUADRANT_NAME[pane.id]}”`, `name:${pane.id}`)}
            onFilter={(filter) => patchPane(pane.id, { filter }, `Changed pane “${pane.name}”`)}
            onReset={() => patchPane(pane.id, null, `Reset pane “${pane.name}”`)}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <p className={styles.noPane} data-testid="customize-panes-no-pane">
          {noneOpen === 0
            ? 'Every open task is in a pane.'
            : `${noneOpen} open ${noneOpen === 1 ? 'task is' : 'tasks are'} in no pane — hidden from the matrix, counted under it.`}
          {screenFilters > 0 && (
            <span data-testid="eisenhower-settings-filter-note">
              {` The counts leave out what the screen filter hides (${screenFilters} ${screenFilters === 1 ? 'filter' : 'filters'} on).`}
            </span>
          )}
        </p>
        <button
          type="button"
          className={`${sectionStyles.button} ${sectionStyles.buttonSecondary}`}
          disabled={!anyCustom}
          onClick={() => setConfirmReset(true)}
        >
          Reset all panes…
        </button>
      </div>
      <ConfirmDialog
        open={confirmReset}
        title="Reset all panes?"
        message="Every pane goes back to its default name and filter (Do, Schedule, Delegate, Drop), in every Eisenhower and on the dashboard."
        confirmLabel="Reset all panes"
        onConfirm={() => {
          setConfirmReset(false)
          void useSettingsStore.getState().setEisenhowerPanes(undefined, 'Reset the Eisenhower panes')
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}

interface PaneCardProps {
  pane: EisenhowerPane
  names: FilterChipNames
  /** Open tasks in the pane now. */
  count: number
  onRename: (name: string) => void
  onFilter: (filter: TodoPredicate) => void
  onReset: () => void
}

/** One pane: its name, its filter as chips, its count now, Reset pane. */
function PaneCard({ pane, names, count, onRename, onFilter, onReset }: PaneCardProps) {
  const nameId = useId()
  // The field keeps what is typed (spaces included); the pane stores it trimmed.
  const stored = pane.customName ? pane.name : ''
  const [name, setName] = useState(stored)
  // A change from elsewhere (Reset pane, Reset all, Undo) shows in the field.
  const [syncedFrom, setSyncedFrom] = useState(stored)
  if (syncedFrom !== stored) {
    setSyncedFrom(stored)
    if (name.trim() !== stored) setName(stored)
  }
  const hasChips = useMemo(() => predicateLineItems(pane.filter, names).length > 0, [pane.filter, names])
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
          id={nameId}
          className={styles.nameInput}
          value={name}
          placeholder={QUADRANT_NAME[pane.id]}
          data-settings-focus={eisenhowerPaneFocus(pane.id)}
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
          layout="stack"
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
