import { emptyPredicate, type PersistedTodoItem, type Person, type Status, type Tag } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import type { EisenhowerQuadrant } from '../models/workspace-layout'
import { QUADRANT_COLOR, type EisenhowerPane } from '../utils/eisenhower-panes'
import { urgentRangeLabel, type UrgentDueWithinDays } from '../utils/urgency'
import type { FilterCriteria } from '../utils/filter-criteria'
import { createPredicateEvaluator, createScreenComposedEvaluator, type FilterSettings } from '../utils/filter-match'
import type { WeekStart } from '../utils/effective-date'
import type { TodoNameLookups } from '../utils/filter'
import type { ListRanks } from '../utils/list-order'
import type { MarkerSettings } from '../utils/markers'
import { bySortOrder } from '../utils/sort-order'
import { buildList } from './build-list'
import type { CopyTaskSection } from './task-copy'
import type { TaskDialogPayload, TaskDialogSource } from '../stores/task-dialog-payload'

/**
 * The task dialog: the tasks behind a number (a dashboard count) or an
 * attribute (a person chip), as a modal list. A payload says what to show
 * and in words what was counted; its source is resolved to rows once, when
 * the dialog opens, so rows stay in place (a completed one struck through)
 * until it closes.
 */

/** A resolved heading; `label` null = a flat list (no header). */
export interface TaskDialogRowGroup {
  key: string
  label: string | null
  color?: string
  todoIds: number[]
}

/** What a source is resolved with: the stores as they are when the dialog opens. */
export interface TaskDialogEnv {
  todos: readonly PersistedTodoItem[]
  today: Date
  weekStartsOn: WeekStart
  markerSettings: MarkerSettings
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  people: Person[]
  statuses: Status[]
  /** List definitions as shown (unsaved drafts over the stored ones). */
  listDefinitions: readonly PersistedListDefinition[]
  /** The top-bar filter (list sources compose it in). */
  screen: FilterCriteria
  listRanks: ReadonlyMap<number, ListRanks>
}

function lookupsOf(env: TaskDialogEnv): TodoNameLookups {
  return {
    assignedPeopleMap: env.assignedPeopleMap,
    assignedTagsMap: env.assignedTagsMap,
    statusesById: new Map(env.statuses.map((s) => [s.id!, s])),
  }
}

function filterSettingsOf(env: TaskDialogEnv): FilterSettings {
  return { ...env.markerSettings, weekStartsOn: env.weekStartsOn }
}

/** The rows a source stands for, as headings of task ids in display order. */
export function resolveTaskDialog(source: TaskDialogSource, env: TaskDialogEnv): TaskDialogRowGroup[] {
  switch (source.kind) {
    case 'todos':
      return [{ key: 'all', label: null, todoIds: [...source.todoIds] }]
    case 'groups':
      return source.groups
        .filter((g) => g.todoIds.length > 0)
        .map((g) => ({ key: g.key, label: g.label, ...(g.color ? { color: g.color } : {}), todoIds: [...g.todoIds] }))
    case 'predicate': {
      const matches = createPredicateEvaluator(lookupsOf(env), env.today, filterSettingsOf(env))
      const todoIds = env.todos.filter((t) => matches(source.predicate, t)).sort(bySortOrder).map((t) => t.id)
      return [{ key: 'all', label: null, todoIds }]
    }
    case 'list': {
      const def = env.listDefinitions.find((d) => d.id === source.listDefinitionId)
      if (!def) return []
      const list = buildList(def, env.todos, {
        today: env.today,
        weekStartsOn: env.weekStartsOn,
        evalPredicate: createScreenComposedEvaluator(env.screen, lookupsOf(env), env.today, filterSettingsOf(env)),
        assignedPeopleMap: env.assignedPeopleMap,
        assignedTagsMap: env.assignedTagsMap,
        people: env.people,
        statuses: env.statuses,
        ranks: env.listRanks.get(def.id) ?? new Map(),
        urgentRange: env.markerSettings.urgentRange,
      })
      const sections = list.sections
      const grouped = !(sections.length === 1 && sections[0]?.key === 'all')
      return sections.map((s) => ({
        key: s.key,
        label: grouped ? s.label : null,
        ...(grouped && s.accentColor ? { color: s.accentColor } : {}),
        todoIds: s.todos.map((t) => t.id),
      }))
    }
  }
}

/** How many tasks the dialog shows (a task under two headings counts once). */
export function taskDialogCount(groups: readonly TaskDialogRowGroup[]): number {
  return new Set(groups.flatMap((g) => g.todoIds)).size
}

/** The rows as `copyTasksRich` sections (tasks deleted since are left out). */
export function taskDialogCopySections(
  groups: readonly TaskDialogRowGroup[],
  todoById: ReadonlyMap<number, PersistedTodoItem>,
): CopyTaskSection[] {
  return groups.map((g) => ({
    ...(g.label ? { label: g.label } : {}),
    todos: g.todoIds.flatMap((id) => {
      const t = todoById.get(id)
      return t ? [t] : []
    }),
  }))
}

/** A person's open tasks (a task row's avatar menu › Show tasks). */
export function personTaskDialog(person: Pick<Person, 'id' | 'name'>): TaskDialogPayload {
  return {
    title: person.name,
    glyph: 'people',
    description: `Open tasks assigned to ${person.name}.`,
    source: {
      kind: 'predicate',
      predicate: { ...emptyPredicate(), personIds: [person.id!] },
    },
    ...(person.id != null ? { personId: person.id } : {}),
  }
}

// ── Dashboard sections ──────────────────────────────────────────────────────
// The tasks are the ones the section counted (screen-filtered), in its order.

/** A Tags row: that tag's open tasks; `null` = the No tag row. */
export function tagSectionDialog(tag: Pick<Tag, 'id' | 'name'> | null, todoIds: readonly number[]): TaskDialogPayload {
  return {
    title: tag ? `#${tag.name}` : 'No tag',
    glyph: 'tag',
    description: tag ? `Open tasks tagged #${tag.name}.` : 'Open tasks with no tag.',
    source: { kind: 'todos', todoIds },
  }
}

/** The Tags count: every row under its own heading. */
export function tagsSectionDialog(rows: ReadonlyArray<{ tag: Tag | null; todoIds: readonly number[] }>): TaskDialogPayload {
  return {
    title: 'Tagged tasks',
    glyph: 'tag',
    description: 'Open tasks by tag. A task with several tags shows under each.',
    source: {
      kind: 'groups',
      groups: rows.map(({ tag, todoIds }) => (tag
        ? { key: `tag-${tag.id}`, label: `#${tag.name}`, ...(tag.color ? { color: tag.color } : {}), todoIds }
        : { key: 'untagged', label: 'No tag', todoIds })),
    },
  }
}

export function staleTasksDialog(todoIds: readonly number[], days: number): TaskDialogPayload {
  return {
    title: 'Stale tasks',
    glyph: 'stale',
    description: `Open tasks not changed in ${days} days or more, oldest first.`,
    source: { kind: 'todos', todoIds },
  }
}

export function recentlyCompletedDialog(todoIds: readonly number[], days: number): TaskDialogPayload {
  return {
    title: 'Recently completed',
    glyph: 'done',
    description: `Tasks completed in the last ${days} days, newest first.`,
    source: { kind: 'todos', todoIds },
  }
}

const QUADRANT_WORDS: Record<EisenhowerQuadrant, string> = {
  do: 'urgent and important',
  schedule: 'important, not urgent',
  delegate: 'urgent, not important',
  drop: 'neither urgent nor important',
}

/** What the app-wide urgent range adds to Urgent, as a sentence (empty when it's off). */
function urgentIncludes(range: UrgentDueWithinDays): string {
  if (range == null) return ''
  if (range === 0) return ' Urgent includes tasks due today or earlier.'
  return ` Urgent includes tasks due within ${urgentRangeLabel(range)}.`
}

/** What the Eisenhower counts are taken from, for a dialog's description. */
export interface EisenhowerDialogSource {
  /** The app-wide urgent range (what Urgent includes). */
  urgentRange: UrgentDueWithinDays
  /** The source list's name; `null` = all tasks. */
  listName: string | null
}

/** ` of “Team”` for a list source, else nothing. */
function ofList(listName: string | null): string {
  return listName == null ? '' : ` of “${listName}”`
}

/**
 * An Eisenhower summary pane: its open tasks. A default pane is described
 * by its quadrant (`Open tasks that are urgent and important.`), a custom
 * one by its filter in words (`subtitle`).
 */
export function eisenhowerQuadrantDialog(
  pane: EisenhowerPane,
  subtitle: string,
  todoIds: readonly number[],
  { urgentRange, listName }: EisenhowerDialogSource,
): TaskDialogPayload {
  const description = pane.customFilter
    ? `Open tasks${ofList(listName)} in “${pane.name}” (${subtitle}) — the first pane each matches.`
    : `Open tasks${ofList(listName)} that are ${QUADRANT_WORDS[pane.id]}.${urgentIncludes(urgentRange)}`
  return {
    title: pane.name,
    glyph: 'matrix',
    description,
    source: { kind: 'todos', todoIds },
  }
}

/** The Eisenhower summary's count: every pane under its heading. */
export function eisenhowerSummaryDialog(
  panes: readonly EisenhowerPane[],
  ids: Readonly<Record<EisenhowerQuadrant, readonly number[]>>,
  { urgentRange, listName }: EisenhowerDialogSource,
): TaskDialogPayload {
  const custom = panes.some((p) => p.customFilter)
  return {
    title: 'Eisenhower',
    glyph: 'matrix',
    description: custom
      ? `Open tasks${ofList(listName)} by pane, each in the first pane it matches.${urgentIncludes(urgentRange)}`
      : `Open tasks${ofList(listName)} by urgent × important.${urgentIncludes(urgentRange)}`,
    source: {
      kind: 'groups',
      groups: panes.map((p) => ({ key: p.id, label: p.name, color: QUADRANT_COLOR[p.id], todoIds: ids[p.id] })),
    },
  }
}

/** A tag's open tasks (a task row's tag menu › Show tasks). */
export function tagTaskDialog(tag: Pick<Tag, 'id' | 'name'>): TaskDialogPayload {
  return {
    title: `#${tag.name}`,
    glyph: 'tag',
    description: `Open tasks tagged #${tag.name}.`,
    source: {
      kind: 'predicate',
      predicate: { ...emptyPredicate(), tags: [tag.id!] },
    },
  }
}

/** An Eisenhower tab's open tasks that no pane's filter matches (the line under its panes). */
export function noPaneTaskDialog(todoIds: readonly number[]): TaskDialogPayload {
  return {
    title: 'In no pane',
    glyph: 'matrix',
    description: 'Open tasks the Eisenhower considers that match none of its panes’ filters.',
    source: { kind: 'todos', todoIds },
  }
}
