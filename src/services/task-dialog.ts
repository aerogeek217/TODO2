import { emptyPredicate, type PersistedTodoItem, type Person, type Status, type Tag } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
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

/** A person's open tasks (the person chip on a task row). */
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
