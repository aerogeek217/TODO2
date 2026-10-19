import { useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { TodoPredicate } from '../../../models'
import type { EisenhowerQuadrant } from '../../../models/workspace-layout'
import { usePaneContext } from '../../../hooks/use-pane-context'
import { useEqualValue } from '../../../hooks/use-equal-value'
import { useEisenhowerSource } from '../../../hooks/use-eisenhower-source'
import { listsLosingLastWidgetToSource } from '../../../hooks/use-list-widget-count'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useFilterStore } from '../../../stores/filter-store'
import { eisenhowerPaneFocus } from '../../../stores/ui-store'
import { countActiveFilters } from '../../../utils/filter-criteria'
import { classifyPanes } from '../../../utils/eisenhower'
import {
  eisenhowerSourceDescription,
  paneSubtitle,
  QUADRANT_COLOR,
  QUADRANT_NAME,
  resolvePanes,
  samePaneFilters,
  withPaneConfig,
  type EisenhowerPane,
} from '../../../utils/eisenhower-panes'
import { filterChips, type FilterChipNames } from '../../../utils/filter-chips'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { ChevronDownIcon } from '../../shared/icons'
import { ConfirmDialog } from '../../shared/Dialog'
import { MenuPopover } from '../../shared/MenuPopover'
import { ALL_TASKS_LABEL, DELETED_LIST_TITLE, listChoiceEntries } from '../../shared/list-choice-entries'
import { UnsavedPrompt } from '../../workspace/UnsavedPrompt'
import { SettingRow } from './SettingRow'
import { useStackedLayer } from './settings-layer'
import sectionStyles from './sections.module.css'
import styles from './EisenhowerSection.module.css'

const SOURCE_MENU_WIDTH_PX = 240

/** Saves pane `q`'s settings patched (`null` = reset), from the panes as they are now (two quick edits mustn't drop one another). */
function patchPane(q: EisenhowerQuadrant, patch: Parameters<typeof withPaneConfig>[2], description: string, mergeKey?: string): void {
  const store = useSettingsStore.getState()
  void store.setEisenhowerPanes(withPaneConfig(store.eisenhowerPanes, q, patch), description, mergeKey)
}

/**
 * Settings › Tasks › Eisenhower: what every Eisenhower (and the dashboard's
 * Eisenhower section) shows — all tasks or one saved list — and its four
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
  const shown = source.kind === 'tasks' ? source.shown : NO_TASKS
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
      <SettingRow label="Show" help="The tasks every Eisenhower and the dashboard sort into the panes.">
        <SourceSelect />
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

const NO_TASKS: never[] = []

/**
 * The Show select-button: the source now (All tasks, a list's name, or
 * `(Deleted list)`); opens All tasks + the saved lists as radios (the
 * choices of a list tab's Change list). A pick is saved at once as one undo
 * step — after Save / Discard when it would leave the source list's unsaved
 * edits with no widget showing them.
 */
function SourceSelect() {
  const listId = useSettingsStore((s) => s.eisenhowerListId)
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const ref = useRef<HTMLButtonElement | null>(null)
  const labelId = useId()
  const valueId = useId()
  const [open, setOpen] = useState(false)
  const [guard, setGuard] = useState<{ listIds: number[]; run: () => void } | null>(null)
  // A click on the button while its menu is open closes it (the menu's
  // outside-click handler already did) instead of reopening it.
  const wasOpen = useRef(false)
  useStackedLayer(guard != null)

  const nameOf = (id: number) => listDefinitions.find((d) => d.id === id)?.name
  const value = listId == null ? ALL_TASKS_LABEL : (nameOf(listId) ?? DELETED_LIST_TITLE)
  const pick = (id: number | undefined) => {
    const next = id ?? null
    if (next === listId) return
    const name = next == null ? null : (nameOf(next) ?? DELETED_LIST_TITLE)
    const run = () => { void useSettingsStore.getState().setEisenhowerListId(next, eisenhowerSourceDescription(name)) }
    const listIds = listsLosingLastWidgetToSource(next)
    if (listIds.length === 0) run()
    else setGuard({ listIds, run })
  }

  return (
    <>
      <span id={labelId} hidden>Eisenhower shows</span>
      <button
        ref={ref}
        type="button"
        className={`${styles.select} ${open ? styles.selectOpen : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        data-testid="eisenhower-source"
        onMouseDown={() => { wasOpen.current = open }}
        onClick={() => {
          if (wasOpen.current) {
            wasOpen.current = false
            return
          }
          setOpen(true)
        }}
      >
        <span id={valueId} className={styles.selectValue}>{value}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <MenuPopover
          anchorRef={ref}
          placement="bottom-start"
          width={SOURCE_MENU_WIDTH_PX}
          label="Eisenhower shows"
          entries={listChoiceEntries(listDefinitions, pick, { current: listId ?? undefined })}
          onClose={() => setOpen(false)}
        />
      )}
      {guard && (
        <UnsavedPrompt
          lead="You’re changing what the Eisenhower shows."
          layout={false}
          listIds={guard.listIds}
          onDone={() => { guard.run(); setGuard(null) }}
          onCancel={() => setGuard(null)}
        />
      )}
    </>
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
