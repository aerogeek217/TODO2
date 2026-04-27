import type {
  PersistedListDefinition,
  RuntimeFilterField,
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

const RUNTIME_FILTER_OPTIONS: { value: RuntimeFilterField | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'person', label: 'Person' },
  { value: 'org', label: 'Org' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
  { value: 'tag', label: 'Tag' },
]

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

  const setRuntimeFilter = (value: RuntimeFilterField | 'none') => {
    if (value === 'none') {
      if (!draft.runtimeFilter) return
      const { runtimeFilter: _drop, ...rest } = draft
      void _drop
      onChange(rest as PersistedListDefinition)
      return
    }
    if (draft.runtimeFilter?.field === value) return
    onChange({ ...draft, runtimeFilter: { field: value } })
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
          title="When set, the list surface asks the user for a value before rendering — e.g. 'Tasks for {assignee}'."
        >
          Prompt
        </span>
        <select
          className={local.configSelect}
          value={draft.runtimeFilter?.field ?? 'none'}
          onChange={(e) => setRuntimeFilter(e.target.value as RuntimeFilterField | 'none')}
        >
          {RUNTIME_FILTER_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
