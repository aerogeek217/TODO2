import { useId, useState } from 'react'
import type {
  PersistedListDefinition,
  RuntimeFilterField,
} from '../../models/list-definition'
import type { TodoGroupBy, TodoSortBy } from '../../models'
import {
  choicesWith,
  GROUP_LABEL,
  LIST_GROUP_CHOICES,
  LIST_PROMPT_CHOICES,
  LIST_SORT_CHOICES,
  PROMPT_LABEL,
  SORT_LABEL,
} from '../../utils/list-options'
import { PredicateChips } from '../workspace/list/PredicateChips'
import styles from './ListEditorBody.module.css'

export interface ListEditorBodyProps {
  draft: PersistedListDefinition
  onChange: (next: PersistedListDefinition) => void
}

const PROMPT_EDITOR_LABEL: Record<RuntimeFilterField | 'none', string> = { ...PROMPT_LABEL, none: 'Nothing' }

/**
 * The list editor's form: name, filters (the same chips as a list widget's
 * filter row, plus Show completed), group by, sort by, max tasks and the
 * prompt field. Edits the caller's draft; the dialog saves it.
 */
export function ListEditorBody({ draft, onChange }: ListEditorBodyProps) {
  const idBase = useId()
  const predicate = draft.membership.predicate
  const limitMode = draft.limitMode ?? 'hard'
  const [maxText, setMaxText] = useState(draft.maxTasks != null ? String(draft.maxTasks) : '')

  const setMax = (text: string) => {
    if (!/^\d*$/.test(text)) return
    setMaxText(text)
    const n = text === '' ? 0 : Number(text)
    const next = { ...draft }
    if (n < 1) delete next.maxTasks
    else next.maxTasks = Math.min(n, 10000)
    onChange(next)
  }

  const setRuntimeFilter = (value: RuntimeFilterField | 'none') => {
    if (value === 'none') {
      if (!draft.runtimeFilter) return
      const next = { ...draft }
      delete next.runtimeFilter
      onChange(next)
      return
    }
    if (draft.runtimeFilter?.field === value) return
    onChange({ ...draft, runtimeFilter: { field: value } })
  }

  const promptValue = draft.runtimeFilter?.field ?? 'none'

  return (
    <div className={styles.form}>
      <label className={styles.row} htmlFor={`${idBase}-name`}>
        <span className={styles.label}>Name</span>
        <input
          id={`${idBase}-name`}
          type="text"
          className={styles.input}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="List name"
        />
      </label>

      <div className={styles.row}>
        <span className={styles.label}>Filters</span>
        <div className={styles.filters}>
          <div className={styles.chips}>
            <PredicateChips
              predicate={predicate}
              onChange={(next) => onChange({ ...draft, membership: { kind: 'custom', predicate: next } })}
            />
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={predicate.showCompleted}
              onChange={(e) => onChange({ ...draft, membership: { kind: 'custom', predicate: { ...predicate, showCompleted: e.target.checked } } })}
            />
            Show completed tasks
          </label>
        </div>
      </div>

      <label className={styles.row} htmlFor={`${idBase}-group`}>
        <span className={styles.label}>Group by</span>
        <select
          id={`${idBase}-group`}
          className={styles.select}
          value={draft.grouping}
          onChange={(e) => onChange({ ...draft, grouping: e.target.value as TodoGroupBy })}
        >
          {choicesWith<TodoGroupBy>(LIST_GROUP_CHOICES, draft.grouping).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
        </select>
      </label>

      <label className={styles.row} htmlFor={`${idBase}-sort`}>
        <span className={styles.label}>Sort by</span>
        <select
          id={`${idBase}-sort`}
          className={styles.select}
          value={draft.sort}
          onChange={(e) => onChange({ ...draft, sort: e.target.value as TodoSortBy })}
        >
          {choicesWith<TodoSortBy>(LIST_SORT_CHOICES, draft.sort).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
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
              onClick={() => onChange({ ...draft, limitMode: mode })}
            >
              {mode === 'hard' ? 'Hard cap' : 'Scroll'}
            </button>
          ))}
        </div>
      </div>

      <label className={styles.row} htmlFor={`${idBase}-prompt`}>
        <span className={styles.label}>Prompt for</span>
        <select
          id={`${idBase}-prompt`}
          className={styles.select}
          value={promptValue}
          onChange={(e) => setRuntimeFilter(e.target.value as RuntimeFilterField | 'none')}
        >
          {choicesWith<RuntimeFilterField | 'none'>(LIST_PROMPT_CHOICES, promptValue).map((p) => (
            <option key={p} value={p}>{PROMPT_EDITOR_LABEL[p]}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
