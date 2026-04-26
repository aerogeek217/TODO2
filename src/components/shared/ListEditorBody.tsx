import type {
  ListGrouping,
  ListSort,
  PersistedListDefinition,
  RuntimeFilterField,
} from '../../models/list-definition'
import type { ListSortBy, TodoPredicate } from '../../models'
import { ListFilterEditor } from '../settings/ListFilterEditor'
import local from '../settings/DashboardListsEditor.module.css'

type SortSelectValue =
  | 'sort-order'
  | 'effective-date-asc'
  | 'scheduled-asc'
  | 'deadline-asc'
  | `sortBy:${ListSortBy}`

type GroupingSelectValue =
  | 'none'
  | 'relative-effective'
  | 'relative-deadline'
  | 'by-sortBy'
  | `by-field:${ListSortBy}`
  | 'by-tag'

const SORT_OPTIONS: { value: SortSelectValue; label: string }[] = [
  { value: 'sort-order', label: 'None' },
  { value: 'effective-date-asc', label: 'Effective date' },
  { value: 'scheduled-asc', label: 'Scheduled date' },
  { value: 'deadline-asc', label: 'Deadline' },
  { value: 'sortBy:date', label: 'Date' },
  { value: 'sortBy:scheduled', label: 'Scheduled' },
  { value: 'sortBy:deadline', label: 'Deadline (within group)' },
  { value: 'sortBy:project', label: 'Project' },
  { value: 'sortBy:status', label: 'Status' },
  { value: 'sortBy:people', label: 'People' },
  { value: 'sortBy:org', label: 'Org' },
]

const GROUPING_OPTIONS: {
  value: GroupingSelectValue
  label: string
  requiresSortBy?: true
}[] = [
  { value: 'none', label: 'None' },
  { value: 'relative-effective', label: 'Relative (effective)' },
  { value: 'relative-deadline', label: 'Relative (deadline)' },
  { value: 'by-sortBy', label: 'Match sort field', requiresSortBy: true },
  { value: 'by-field:date', label: 'By date' },
  { value: 'by-field:scheduled', label: 'By scheduled' },
  { value: 'by-field:deadline', label: 'By deadline' },
  { value: 'by-field:project', label: 'By project' },
  { value: 'by-field:status', label: 'By status' },
  { value: 'by-field:people', label: 'By people' },
  { value: 'by-field:org', label: 'By org' },
  { value: 'by-tag', label: 'By tag' },
]

const RUNTIME_FILTER_OPTIONS: { value: RuntimeFilterField | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'person', label: 'Person' },
  { value: 'org', label: 'Org' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
  { value: 'tag', label: 'Tag' },
]

function encodeSortValue(sort: ListSort): SortSelectValue {
  if (sort.kind === 'sortBy') return `sortBy:${sort.by}`
  return sort.kind
}

function decodeSortValue(value: SortSelectValue): ListSort {
  if (value.startsWith('sortBy:')) {
    return { kind: 'sortBy', by: value.slice('sortBy:'.length) as ListSortBy }
  }
  return { kind: value as Exclude<ListSort['kind'], 'sortBy'> }
}

function encodeGroupingValue(grouping: ListGrouping): GroupingSelectValue {
  if (grouping.kind === 'by-field') return `by-field:${grouping.by}`
  return grouping.kind
}

function decodeGroupingValue(value: GroupingSelectValue): ListGrouping {
  if (value.startsWith('by-field:')) {
    return { kind: 'by-field', by: value.slice('by-field:'.length) as ListSortBy }
  }
  return { kind: value as Exclude<ListGrouping['kind'], 'by-field'> }
}

export interface ListEditorBodyProps {
  draft: PersistedListDefinition
  onChange: (next: PersistedListDefinition) => void
}

export function ListEditorBody({ draft, onChange }: ListEditorBodyProps) {
  const setName = (name: string) => onChange({ ...draft, name })

  const setSort = (value: SortSelectValue) => {
    const next = decodeSortValue(value)
    if (next.kind === draft.sort.kind
      && (next.kind !== 'sortBy' || (draft.sort.kind === 'sortBy' && next.by === draft.sort.by))) return
    const grouping: ListGrouping = draft.grouping.kind === 'by-sortBy' && next.kind !== 'sortBy'
      ? { kind: 'none' }
      : draft.grouping
    onChange({ ...draft, sort: next, grouping })
  }

  const setGrouping = (value: GroupingSelectValue) => {
    onChange({ ...draft, grouping: decodeGroupingValue(value) })
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

      <div className={local.configRow}>
        <span className={local.configLabel}>Sort</span>
        <select
          className={local.configSelect}
          value={encodeSortValue(draft.sort)}
          onChange={(e) => setSort(e.target.value as SortSelectValue)}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className={local.configRow}>
        <span className={local.configLabel}>Grouping</span>
        <select
          className={local.configSelect}
          value={encodeGroupingValue(draft.grouping)}
          onChange={(e) => setGrouping(e.target.value as GroupingSelectValue)}
        >
          {GROUPING_OPTIONS.map(({ value, label, requiresSortBy }) => (
            <option
              key={value}
              value={value}
              disabled={requiresSortBy && draft.sort.kind !== 'sortBy'}
            >
              {label}
            </option>
          ))}
        </select>
      </div>

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
