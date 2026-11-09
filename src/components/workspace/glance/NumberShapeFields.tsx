import { useId, useState } from 'react'
import { emptyPredicate } from '../../../models/filter-predicate'
import { NUMBER_NAME_MAX, type NumberConfig } from '../../../models/glance-widgets'
import { listedLists } from '../../../models/list-definition'
import {
  DEFAULT_NUMBER_GOAL,
  DEFAULT_NUMBER_OLDEST_BY,
  goalBound,
  NUMBER_GOAL_MAX,
  NUMBER_GROUP_MAX,
  NUMBER_OLDEST_BY,
  NUMBER_OLDEST_BY_LABELS,
  NUMBER_SHOW_LABELS,
  NUMBER_SHOWS,
  type NumberGoal,
  type NumberGroupItem,
  type NumberOldestBy,
  type NumberShow,
} from '../../../models/number-shapes'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { bySortOrder } from '../../../utils/sort-order'
import { ColorPicker } from '../../shared/ColorPicker'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { CloseIcon, PlusIcon } from '../../shared/icons'
import styles from './NumberEditor.module.css'

/**
 * Edit number's shape fields (D26 P6, boards X and Y): the Show picker and
 * each shape's own fields — Share of…'s second filter, Oldest's date, a
 * goal, a group's counts, the list followed. The editor shows only the
 * active shape's. Each writes through `patch` (layout config).
 */

type Patch = (p: Partial<NumberConfig>) => void

/** What the colour picker shows while a colour is on Auto (no preset, as the layout dialog's None; picking one leaves Auto). */
export const AUTO_SHOWN = '#8a7cf0'

/** A radio before the presets that stands for Auto (neutral, lit in the accent). */
export function AutoSwatch({ name, checked, onPick, className }: { name: string; checked: boolean; onPick: () => void; className?: string }) {
  return (
    <input
      type="radio"
      name={name}
      className={className}
      checked={checked}
      onChange={onPick}
      aria-label="Auto (neutral, lit in the accent)"
      title="Auto: neutral, lit in the accent"
      data-hue="auto"
    />
  )
}

/** The Show picker: the Number's shape. */
export function ShowField({ value, onShow }: { value: NumberShow; onShow: (show: NumberShow) => void }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>Show</span>
      <select className={styles.select} value={value} onChange={(e) => onShow(e.target.value as NumberShow)} data-testid="number-editor-show">
        {NUMBER_SHOWS.map((s) => <option key={s} value={s}>{NUMBER_SHOW_LABELS[s]}</option>)}
      </select>
    </label>
  )
}

/** A whole-number field (0 – `max`), written once it reads as one (blank or bad text isn't written). */
export function WholeNumberField({ value, onChange, label, max }: { value: number; onChange: (n: number) => void; label: string; max: number }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value))
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      step={1}
      className={styles.number}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= max) onChange(n)
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

/** Share of…: the second filter — the whole the Number's tasks are a share of (empty: every open task). */
export function ShareOfField({ config, patch }: { config: NumberConfig; patch: Patch }) {
  const id = useId()
  const of = config.of ?? emptyPredicate()
  return (
    <div className={styles.fieldset} role="group" aria-labelledby={`${id}-of`}>
      <span id={`${id}-of`} className={styles.label}>Out of tasks where</span>
      <div className={styles.filter} data-testid="number-editor-of">
        <PredicateChips
          predicate={of}
          onChange={(next) => patch({ of: hasFilterClause(next) || next.expression || next.showCompleted ? next : undefined })}
          addLabel="Out of tasks where"
          layout="stack"
          inDialog
          before={hasFilterClause(of) || of.expression ? undefined : <span className={styles.noFilter}>No filter — every open task</span>}
        />
      </div>
    </div>
  )
}

/** Oldest: the date its tasks age by. */
export function OldestByField({ config, patch }: { config: NumberConfig; patch: Patch }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>Age by</span>
      <select
        className={styles.select}
        value={config.oldestBy ?? DEFAULT_NUMBER_OLDEST_BY}
        onChange={(e) => patch({ oldestBy: e.target.value as NumberOldestBy })}
      >
        {NUMBER_OLDEST_BY.map((b) => <option key={b} value={b}>{NUMBER_OLDEST_BY_LABELS[b]}</option>)}
      </select>
    </label>
  )
}

/** Against a goal: at most / at least a number, and its period (none, or a week with a pace). */
export function GoalFields({ config, patch }: { config: NumberConfig; patch: Patch }) {
  const goal = config.goal ?? DEFAULT_NUMBER_GOAL
  const { way, value } = goalBound(goal)
  const period = goal.period
  const write = (next: { way: 'atMost' | 'atLeast'; value: number; period: 'week' | undefined }) => {
    const bound = next.way === 'atMost' ? { atMost: next.value } : { atLeast: next.value }
    const g: NumberGoal = next.period ? { ...bound, period: next.period } : bound
    patch({ goal: g })
  }
  return (
    <>
      <div className={styles.field}>
        <span className={styles.label} aria-hidden="true">Goal</span>
        <span className={styles.litRow}>
          <select
            className={styles.select}
            aria-label="Goal"
            value={way}
            onChange={(e) => write({ way: e.target.value as 'atMost' | 'atLeast', value, period })}
          >
            <option value="atLeast">At least</option>
            <option value="atMost">At most</option>
          </select>
          <WholeNumberField value={value} max={NUMBER_GOAL_MAX} label={`Goal: ${way === 'atMost' ? 'at most' : 'at least'}`} onChange={(n) => write({ way, value: n, period })} />
        </span>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Pace</span>
        <select
          className={styles.select}
          value={period ?? 'none'}
          onChange={(e) => write({ way, value, period: e.target.value === 'week' ? 'week' : undefined })}
        >
          <option value="none">None</option>
          <option value="week">Through the week</option>
        </select>
      </label>
    </>
  )
}

/** Follow a list: one of the layout's lists. */
export function ListField({ config, patch }: { config: NumberConfig; patch: Patch }) {
  const layoutId = useWorkspaceStore((s) => s.working?.id)
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const lists = listedLists([...defs].sort(bySortOrder), layoutId)
  const picked = config.list?.listDefinitionId
  const known = picked != null && lists.some((d) => d.id === picked)
  return (
    <label className={styles.field}>
      <span className={styles.label}>List</span>
      <select
        className={styles.select}
        value={known ? String(picked) : ''}
        onChange={(e) => patch({ list: e.target.value ? { listDefinitionId: Number(e.target.value) } : undefined })}
        data-testid="number-editor-list"
      >
        {!known && <option value="">{picked != null ? '(Deleted list)' : lists.length > 0 ? 'Pick a list' : 'No lists in this layout'}</option>}
        {lists.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
      </select>
    </label>
  )
}

/** A group: its counts, each a name, a colour and a filter; up to six, at least one. */
export function GroupItemsField({ config, patch }: { config: NumberConfig; patch: Patch }) {
  const id = useId()
  const items = config.items ?? []
  const write = (next: NumberGroupItem[]) => patch({ items: next })
  const set = (i: number, item: NumberGroupItem) => write(items.map((it, j) => (j === i ? item : it)))
  return (
    <div className={styles.fieldset} role="group" aria-labelledby={`${id}-items`} data-testid="number-editor-items">
      <span id={`${id}-items`} className={styles.label}>Counts</span>
      {items.map((item, i) => (
        <div key={i} className={styles.item} role="group" aria-label={`Count ${i + 1}`} data-group-item-editor={i}>
          <div className={styles.itemHead}>
            <input
              type="text"
              className={styles.input}
              value={item.name}
              maxLength={NUMBER_NAME_MAX}
              placeholder="Number"
              aria-label={`Count ${i + 1} name`}
              onChange={(e) => set(i, { ...item, name: e.target.value.slice(0, NUMBER_NAME_MAX) })}
            />
            {items.length > 1 && (
              <button type="button" className={styles.close} aria-label={`Remove count ${i + 1}`} title="Remove" onClick={() => write(items.filter((_, j) => j !== i))}>
                <CloseIcon size={12} />
              </button>
            )}
          </div>
          <div className={styles.colors} data-on-auto={item.color == null || undefined}>
            <ColorPicker
              value={item.color ?? AUTO_SHOWN}
              onChange={(hex) => set(i, { ...item, color: hex })}
              before={(
                <AutoSwatch
                  name={`${id}-auto-${i}`}
                  className={styles.auto}
                  checked={item.color == null}
                  onPick={() => {
                    const { color: _color, ...rest } = item
                    void _color
                    set(i, rest)
                  }}
                />
              )}
            />
          </div>
          <div className={styles.filter}>
            <PredicateChips
              predicate={item.filter}
              onChange={(filter) => set(i, { ...item, filter })}
              addLabel="Count tasks where"
              layout="stack"
              inDialog
              before={hasFilterClause(item.filter) || item.filter.expression ? undefined : <span className={styles.noFilter}>No filter — every open task</span>}
            />
          </div>
        </div>
      ))}
      {items.length < NUMBER_GROUP_MAX && (
        <button
          type="button"
          className={styles.addItem}
          onClick={() => write([...items, { name: `Count ${items.length + 1}`, filter: emptyPredicate() }])}
        >
          <PlusIcon size={12} /> Add a count
        </button>
      )}
    </div>
  )
}
