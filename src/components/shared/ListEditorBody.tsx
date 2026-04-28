import type {
  DateOffsetSource,
  PersistedListDefinition,
  RuntimeFilterField,
  RuntimeFilterSpec,
} from '../../models/list-definition'
import type {
  TodoPredicate,
  TodoSortBy,
  TodoGroupBy,
} from '../../models'
import {
  LIST_EDITOR_GROUP_VALUES,
  LIST_EDITOR_SORT_VALUES,
} from '../../models'
import { ListFilterEditor } from '../settings/ListFilterEditor'
import { SortGroupToolbar, type SortGroupOption } from './SortGroupToolbar'
import local from '../settings/DashboardListsEditor.module.css'

const SORT_LABELS: Record<TodoSortBy, string> = {
  manual: 'None (sortOrder)',
  name: 'Name',
  date: 'Effective date',
  scheduled: 'Scheduled',
  deadline: 'Deadline',
  created: 'Created',
  people: 'People',
  project: 'Project',
  org: 'Org',
  status: 'Status',
}

const GROUP_LABELS: Record<TodoGroupBy, string> = {
  none: 'None',
  date: 'By date (relative)',
  scheduled: 'By scheduled (relative)',
  deadline: 'By deadline (relative)',
  people: 'By people',
  project: 'By project',
  org: 'By org',
  status: 'By status',
  tag: 'By tag',
}

const SORT_OPTIONS: readonly SortGroupOption<TodoSortBy>[] =
  LIST_EDITOR_SORT_VALUES.map((v) => ({ value: v, label: SORT_LABELS[v] }))

const GROUP_OPTIONS: readonly SortGroupOption<TodoGroupBy>[] =
  LIST_EDITOR_GROUP_VALUES.map((v) => ({ value: v, label: GROUP_LABELS[v] }))

type RuntimePromptValue = RuntimeFilterField | 'date-offset' | 'none'

const RUNTIME_FILTER_OPTIONS: { value: RuntimePromptValue; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'person', label: 'Person' },
  { value: 'org', label: 'Org' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
  { value: 'tag', label: 'Tag' },
  { value: 'date-offset', label: 'Date offset' },
]

const DATE_OFFSET_SOURCE_OPTIONS: { value: DateOffsetSource; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'due', label: 'Deadline' },
  { value: 'created', label: 'Created' },
  { value: 'completed', label: 'Completed' },
]

function runtimePromptValue(spec: RuntimeFilterSpec | undefined): RuntimePromptValue {
  if (!spec) return 'none'
  return spec.kind === 'date-offset' ? 'date-offset' : spec.field
}

export interface ListEditorBodyProps {
  draft: PersistedListDefinition
  onChange: (next: PersistedListDefinition) => void
}

export function ListEditorBody({ draft, onChange }: ListEditorBodyProps) {
  const setName = (name: string) => onChange({ ...draft, name })

  const setSort = (next: TodoSortBy) => {
    if (next === draft.sort) return
    onChange({ ...draft, sort: next })
  }

  const setGrouping = (next: TodoGroupBy) => {
    if (next === draft.grouping) return
    onChange({ ...draft, grouping: next })
  }

  const setRuntimeFilter = (value: RuntimePromptValue) => {
    if (value === 'none') {
      if (!draft.runtimeFilter) return
      const { runtimeFilter: _drop, ...rest } = draft
      void _drop
      onChange(rest as PersistedListDefinition)
      return
    }
    if (value === 'date-offset') {
      if (draft.runtimeFilter?.kind === 'date-offset') return
      onChange({
        ...draft,
        runtimeFilter: { kind: 'date-offset', source: 'scheduled', anchor: 'today' },
      })
      return
    }
    if (draft.runtimeFilter?.kind === 'value' && draft.runtimeFilter.field === value) return
    onChange({ ...draft, runtimeFilter: { kind: 'value', field: value } })
  }

  const updateDateOffset = (
    patch: Partial<Extract<RuntimeFilterSpec, { kind: 'date-offset' }>>,
  ) => {
    const current = draft.runtimeFilter
    if (current?.kind !== 'date-offset') return
    const next: Extract<RuntimeFilterSpec, { kind: 'date-offset' }> = { ...current, ...patch }
    if (next.minDays === undefined) delete next.minDays
    if (next.maxDays === undefined) delete next.maxDays
    onChange({ ...draft, runtimeFilter: next })
  }

  const parseDayInput = (raw: string): number | undefined => {
    if (raw.trim() === '') return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? Math.trunc(n) : undefined
  }

  const handlePredicateChange = (predicate: TodoPredicate) => {
    onChange({ ...draft, membership: { kind: 'custom', predicate } })
  }

  const currentPredicate = draft.membership.kind === 'custom'
    ? draft.membership.predicate
    : undefined

  return (
    <div className={local.bodyForm}>
      <div className={local.configRow}>
        <span className={local.configLabel}>Name</span>
        <input
          type="text"
          className={local.configInput}
          value={draft.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name"
        />
      </div>

      {currentPredicate && (
        <div className={local.configRow}>
          <span className={local.configLabel}>Filter</span>
          <div className={local.predicateBlock}>
            <ListFilterEditor
              predicate={currentPredicate}
              onChange={handlePredicateChange}
            />
          </div>
        </div>
      )}

      <SortGroupToolbar<TodoSortBy, TodoGroupBy>
        density="comfortable"
        sortBy={draft.sort}
        groupBy={draft.grouping}
        sortOptions={SORT_OPTIONS}
        groupOptions={GROUP_OPTIONS}
        onSortChange={setSort}
        onGroupChange={setGrouping}
        sortLabel="Sort"
        groupLabel="Grouping"
      />

      <div className={local.configRow}>
        <span
          className={local.configLabel}
          title="When set, the list surface asks the user for a value before rendering — e.g. 'Tasks for {assignee}' — or auto-applies a relative date offset."
        >
          Prompt
        </span>
        <select
          className={local.configSelect}
          value={runtimePromptValue(draft.runtimeFilter)}
          onChange={(e) => setRuntimeFilter(e.target.value as RuntimePromptValue)}
        >
          {RUNTIME_FILTER_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {draft.runtimeFilter?.kind === 'date-offset' && (
        <div className={local.configRow}>
          <span
            className={local.configLabel}
            title="Days are evaluated against today (e.g. minDays=-7, maxDays=0 for 'last week'). Leave a bound blank for 'no limit on that side'."
          >
            Offset
          </span>
          <select
            className={local.configSelect}
            value={draft.runtimeFilter.source}
            aria-label="Date offset source"
            onChange={(e) => updateDateOffset({ source: e.target.value as DateOffsetSource })}
          >
            {DATE_OFFSET_SOURCE_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className={local.windowField}>
            <span className={local.windowSuffix}>min</span>
            <input
              type="number"
              className={local.windowInput}
              value={draft.runtimeFilter.minDays ?? ''}
              aria-label="Minimum days from today"
              placeholder="−∞"
              onChange={(e) => updateDateOffset({ minDays: parseDayInput(e.target.value) })}
            />
            <span className={local.windowSuffix}>days</span>
          </span>
          <span className={local.windowField}>
            <span className={local.windowSuffix}>max</span>
            <input
              type="number"
              className={local.windowInput}
              value={draft.runtimeFilter.maxDays ?? ''}
              aria-label="Maximum days from today"
              placeholder="+∞"
              onChange={(e) => updateDateOffset({ maxDays: parseDayInput(e.target.value) })}
            />
            <span className={local.windowSuffix}>days</span>
          </span>
        </div>
      )}
    </div>
  )
}
