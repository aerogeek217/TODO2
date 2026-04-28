import type { TodoPredicate } from './filter-predicate'
import type { TodoSortBy, TodoGroupBy } from './todo-sort-group'

/**
 * Serializable predicate DSL for list membership. Post-v24, the only kind is
 * `custom` — the former `today` / `upcoming` / `deadlines` / `someday` kinds
 * were retired when the 5 horizon seeds landed (each horizon is now a custom
 * predicate authored via `TodoPredicate`). The `kind` discriminator is kept
 * for forward-compat (future kinds like `saved-search` remain cheap to add).
 */
export type ListMembership =
  | { kind: 'custom'; predicate: TodoPredicate }

/**
 * Persisted sort field. Post ui-consistency-2026-04-25 P4 this is a flat
 * `TodoSortBy` literal — the former discriminated union (`{kind:'sort-order'}`
 * / `{kind:'sortBy', by}` / etc.) was flattened in the v46 Dexie migration.
 */
export type ListSort = TodoSortBy

/**
 * Persisted grouping field. Post ui-consistency-2026-04-25 P4 this is a flat
 * `TodoGroupBy` literal — the former discriminated union (`{kind:'none'}` /
 * `{kind:'by-field', by}` / `{kind:'by-tag'}` / etc.) was flattened in the
 * v46 Dexie migration. The former `{kind:'by-sortBy'}` "match the sort"
 * semantic is gone; surfaces that want sort+group coupled set them to the
 * same value explicitly.
 */
export type ListGrouping = TodoGroupBy

/** Which entity a saved list's runtime-filter picker narrows on. */
export type RuntimeFilterField = 'person' | 'org' | 'project' | 'status' | 'tag'

export const RUNTIME_FILTER_FIELDS: readonly RuntimeFilterField[] = [
  'person', 'org', 'project', 'status', 'tag',
]

/** Which date drives the date-offset narrowing. `completed` resolves to `modifiedAt` (the codebase uses it as the completion-time proxy). */
export type DateOffsetSource = 'scheduled' | 'due' | 'created' | 'completed'

export const DATE_OFFSET_SOURCES: readonly DateOffsetSource[] = [
  'scheduled', 'due', 'created', 'completed',
]

/**
 * Anchor point for a date-offset spec. Only `today` is currently supported;
 * `now` is reserved for a future time-of-day variant — written into the type
 * union so persisted shapes don't need a follow-up migration when it lands.
 */
export type DateOffsetAnchor = 'today'

/**
 * Render-time narrowing on a saved list. Two shapes:
 *
 * - `kind: 'value'` (legacy / "prompt the user"): the consumer supplies one or
 *   more ids at render time that merge into the definition's predicate as an
 *   equality on the chosen field (e.g. "Tasks for {assignee}"). The picked
 *   ids are not persisted on the def; each surface keeps its own current pick.
 *
 * - `kind: 'date-offset'`: the def carries a relative date window evaluated
 *   against `today` at render time (e.g. "scheduled in [-7, 0] days" for a
 *   stale-task list). No user prompt — the bounds are baked into the def. Open
 *   bounds are expressed by omitting `minDays` / `maxDays` (undefined ≡ open).
 */
export type RuntimeFilterSpec =
  | {
      kind: 'value'
      field: RuntimeFilterField
      /** Optional override for the picker label; defaults to the capitalised field. */
      label?: string
    }
  | {
      kind: 'date-offset'
      source: DateOffsetSource
      anchor: DateOffsetAnchor
      /** Lower bound in days from anchor; undefined = open lower bound. */
      minDays?: number
      /** Upper bound in days from anchor; undefined = open upper bound. */
      maxDays?: number
      /** Optional override for the chip label; defaults to a derived "{source} ±N" string. */
      label?: string
    }

/**
 * Promote a raw / legacy `runtimeFilter` payload to the discriminated-union
 * shape. Pre-v47 backups carry `{ field, label? }` (no `kind`); the v47 Dexie
 * migration rewrites stored rows in-place, but import-validation runs this on
 * read so the runtime never sees the legacy shape. Returns `undefined` when
 * the payload doesn't fit either variant.
 */
export function normalizeRuntimeFilterSpec(raw: unknown): RuntimeFilterSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const labelOpt = typeof r.label === 'string' && r.label.trim() ? { label: r.label } : {}

  // Legacy shape: { field, label? } with no `kind` discriminator.
  if (typeof r.kind !== 'string' && typeof r.field === 'string') {
    if (!RUNTIME_FILTER_FIELDS.includes(r.field as RuntimeFilterField)) return undefined
    return { kind: 'value', field: r.field as RuntimeFilterField, ...labelOpt }
  }

  if (r.kind === 'value') {
    if (typeof r.field !== 'string' || !RUNTIME_FILTER_FIELDS.includes(r.field as RuntimeFilterField)) return undefined
    return { kind: 'value', field: r.field as RuntimeFilterField, ...labelOpt }
  }

  if (r.kind === 'date-offset') {
    if (typeof r.source !== 'string' || !DATE_OFFSET_SOURCES.includes(r.source as DateOffsetSource)) return undefined
    if (r.anchor !== 'today') return undefined
    const minDays = typeof r.minDays === 'number' && Number.isFinite(r.minDays) ? r.minDays : undefined
    const maxDays = typeof r.maxDays === 'number' && Number.isFinite(r.maxDays) ? r.maxDays : undefined
    return {
      kind: 'date-offset',
      source: r.source as DateOffsetSource,
      anchor: 'today',
      ...(minDays !== undefined ? { minDays } : {}),
      ...(maxDays !== undefined ? { maxDays } : {}),
      ...labelOpt,
    }
  }

  return undefined
}

export interface ListDefinition {
  id?: number
  name: string
  sortOrder: number
  membership: ListMembership
  sort: ListSort
  grouping: ListGrouping
  /** When true, the list appears as a Dashboard card. Default true on migration from pre-v22. */
  pinnedToDashboard: boolean
  /**
   * When true, the list shows up in ListView's favorites chip bar. Separate
   * from `pinnedToDashboard` so the two discoverability surfaces can be
   * toggled independently. Defaults to false.
   */
  favorited: boolean
  /** Optional cap on the number of visible tasks. Undefined = unlimited. */
  maxTasks?: number
  /** How `maxTasks` is enforced. Defaults to `'hard'` when omitted. */
  limitMode?: 'hard' | 'scroll'
  /** When set, the list exposes a picker at render time; see `RuntimeFilterSpec`. */
  runtimeFilter?: RuntimeFilterSpec
}

export type PersistedListDefinition = ListDefinition & { id: number }
