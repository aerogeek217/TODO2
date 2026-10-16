import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedListDefinition, RuntimeFilterField } from '../../../models/list-definition'
import type { TodoGroupBy, TodoSortBy } from '../../../models/todo-sort-group'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useEffectiveListDefinition, useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetStore, type PopoverPoint } from '../../../stores/list-widget-store'
import { useUIStore } from '../../../stores/ui-store'
import {
  choicesWith,
  GROUP_LABEL,
  LIST_GROUP_CHOICES,
  LIST_PROMPT_CHOICES,
  LIST_SORT_CHOICES,
  PROMPT_LABEL,
  SORT_LABEL,
} from '../../../utils/list-options'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { useListWidgetCount } from '../widget-hooks'
import { LinkIcon, PlusIcon } from '../../shared/icons'
import { PredicateFieldPicker } from './PredicateFieldPicker'
import { ADD_FILTER_ITEMS } from './filter-menu'
import { pointBelow } from './popover-point'
import styles from './ListOptions.module.css'

/**
 * The one open list popover of the workspace — List options, the add-filter
 * menu or a filter picker — editing the list's draft (`list-draft-store`).
 * Opened through `useListWidgetStore.openPopover` from the filter row, the
 * tab menu or an empty state.
 */
export function ListOptionsHost() {
  const popover = useListWidgetStore((s) => s.popover)
  const close = useListWidgetStore((s) => s.closePopover)
  const def = useEffectiveListDefinition(popover?.listDefinitionId)
  if (!popover || !def) return null
  const key = JSON.stringify(popover)
  switch (popover.kind) {
    case 'options':
      return <ListOptionsPopover key={key} def={def} at={popover.at} onClose={close} />
    case 'add-filter':
      return <AddFilterMenu key={key} listDefinitionId={def.id} at={popover.at} onClose={close} />
    case 'picker':
      return (
        <PredicateFieldPicker
          key={key}
          field={popover.field}
          predicate={def.membership.predicate}
          onChange={(predicate) => {
            useListDraftStore.getState().edit(def.id, (d) => ({ ...d, membership: { kind: 'custom', predicate } }))
          }}
          at={popover.at}
          adding={popover.adding}
          dateField={popover.dateField}
          onClose={close}
        />
      )
  }
}

/** "Add a filter to this list": a field, then that field's picker. */
function AddFilterMenu({ listDefinitionId, at, onClose }: { listDefinitionId: number; at: PopoverPoint; onClose: () => void }) {
  const open = useListWidgetStore((s) => s.openPopover)
  const entries: MenuEntry[] = [
    { kind: 'label', text: 'Add a filter to this list' },
    ...ADD_FILTER_ITEMS.map((item): MenuEntry => ({
      kind: 'item',
      label: item.label,
      icon: item.icon,
      submenu: item.submenu,
      // The picker replaces this menu.
      keepOpen: true,
      onSelect: () => open({ kind: 'picker', listDefinitionId, field: item.field, dateField: item.dateField, adding: true, at }),
    })),
  ]
  return (
    <MenuPopover
      point={at}
      placement={at.align === 'start' ? 'bottom-start' : 'bottom-end'}
      width={220}
      label="Add a filter"
      entries={entries}
      onClose={onClose}
    />
  )
}

/**
 * List options: group, sort, max tasks, prompt field, filters and show
 * completed. Every control edits the list definition (unsaved until saved).
 */
function ListOptionsPopover({ def, at, onClose }: { def: PersistedListDefinition; at: PopoverPoint; onClose: () => void }) {
  const open = useListWidgetStore((s) => s.openPopover)
  const widgets = useListWidgetCount(def.id)
  const addFilterRef = useRef<HTMLButtonElement>(null)
  const idBase = useId()
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: at.x, y: at.y },
    open: true,
    placement: at.align === 'start' ? 'bottom-start' : 'bottom-end',
    closeOnScroll: false,
    onClose,
  })
  const edit = (fn: (d: PersistedListDefinition) => PersistedListDefinition) => useListDraftStore.getState().edit(def.id, fn)
  const predicate = def.membership.predicate
  const limitMode = def.limitMode ?? 'hard'
  const [maxText, setMaxText] = useState(def.maxTasks != null ? String(def.maxTasks) : '')

  const setMax = (text: string) => {
    if (!/^\d*$/.test(text)) return
    setMaxText(text)
    const n = text === '' ? null : Number(text)
    edit((d) => {
      const next = { ...d }
      if (n == null || n < 1) delete next.maxTasks
      else next.maxTasks = Math.min(n, 10000)
      return next
    })
  }

  const setPrompt = (value: RuntimeFilterField | 'none') => edit((d) => {
    const next = { ...d }
    if (value === 'none') delete next.runtimeFilter
    else if (d.runtimeFilter?.field !== value) next.runtimeFilter = { field: value }
    return next
  })

  const groupChoices = choicesWith<TodoGroupBy>(LIST_GROUP_CHOICES, def.grouping)
  const sortChoices = choicesWith<TodoSortBy>(LIST_SORT_CHOICES, def.sort)
  const promptValue = def.runtimeFilter?.field ?? 'none'
  const promptChoices = choicesWith<RuntimeFilterField | 'none'>(LIST_PROMPT_CHOICES, promptValue)

  return createPortal(
    <div
      ref={panelRef}
      className={styles.popover}
      style={{ position: style.position, left: style.left, top: style.top, maxHeight: style.maxHeight }}
      role="dialog"
      aria-label={`List options: ${def.name}`}
      data-testid="list-options"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
    >
      <label className={styles.row} htmlFor={`${idBase}-group`}>
        <span className={styles.label}>Group</span>
        <select
          id={`${idBase}-group`}
          className={styles.select}
          value={def.grouping}
          onChange={(e) => edit((d) => ({ ...d, grouping: e.target.value as TodoGroupBy }))}
        >
          {groupChoices.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
        </select>
      </label>
      <label className={styles.row} htmlFor={`${idBase}-sort`}>
        <span className={styles.label}>Sort</span>
        <select
          id={`${idBase}-sort`}
          className={styles.select}
          value={def.sort}
          onChange={(e) => edit((d) => ({ ...d, sort: e.target.value as TodoSortBy }))}
        >
          {sortChoices.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
      </label>
      <div className={styles.row}>
        <label className={styles.label} htmlFor={`${idBase}-max`}>Max tasks</label>
        <input
          id={`${idBase}-max`}
          className={styles.maxInput}
          inputMode="numeric"
          placeholder="All"
          value={maxText}
          onChange={(e) => setMax(e.target.value)}
        />
        <div className={styles.segmented} role="radiogroup" aria-label="When over the max">
          {(['hard', 'scroll'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={limitMode === mode}
              className={`${styles.segment} ${limitMode === mode ? styles.segmentOn : ''}`}
              onClick={() => edit((d) => ({ ...d, limitMode: mode }))}
            >
              {mode === 'hard' ? 'Hard' : 'Scroll'}
            </button>
          ))}
        </div>
      </div>
      <label className={styles.row} htmlFor={`${idBase}-prompt`}>
        <span className={styles.label}>Prompt</span>
        <select
          id={`${idBase}-prompt`}
          className={styles.select}
          value={promptValue}
          onChange={(e) => setPrompt(e.target.value as RuntimeFilterField | 'none')}
        >
          {promptChoices.map((p) => <option key={p} value={p}>{PROMPT_LABEL[p]}</option>)}
        </select>
      </label>
      <div className={styles.row}>
        <span className={styles.label}>Filters</span>
        <button
          ref={addFilterRef}
          type="button"
          className={styles.addFilter}
          aria-haspopup="menu"
          onClick={() => {
            if (addFilterRef.current) open({ kind: 'add-filter', listDefinitionId: def.id, at: pointBelow(addFilterRef.current) })
          }}
        >
          <PlusIcon size={12} /> Add filter
        </button>
      </div>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={predicate.showCompleted}
          onChange={(e) => {
            const showCompleted = e.target.checked
            edit((d) => ({ ...d, membership: { kind: 'custom', predicate: { ...d.membership.predicate, showCompleted } } }))
          }}
        />
        Show completed tasks
      </label>
      <div className={styles.separator} />
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.ghost}
          onClick={() => { onClose(); useUIStore.getState().openListEditorDialog(def.id) }}
        >
          Edit list…
        </button>
        <span className={styles.shared}>
          <LinkIcon /> {widgets === 1 ? '1 widget' : `Shared · ${widgets} widgets`}
        </span>
      </div>
    </div>,
    document.body,
  )
}
