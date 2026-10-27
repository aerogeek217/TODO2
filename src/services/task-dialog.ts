import { emptyPredicate, type PersistedTodoItem, type Person, type Status, type Tag } from '../models'
import type { PersistedListDefinition } from '../models/list-definition'
import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../models/todo-sort-group'
import type { EisenhowerQuadrant } from '../models/workspace-layout'
import { QUADRANT_COLOR, type EisenhowerPane } from '../utils/eisenhower-panes'
import { urgentRangeLabel, type UrgentDueWithinDays } from '../utils/urgency'
import { countActiveFilters, predicateToCriteria, type FilterCriteria } from '../utils/filter-criteria'
import { createPredicateEvaluator, createScreenComposedEvaluator, type FilterSettings } from '../utils/filter-match'
import type { WeekStart } from '../utils/effective-date'
import type { TodoNameLookups } from '../utils/filter'
import type { ListRanks } from '../utils/list-order'
import type { MarkerSettings } from '../utils/markers'
import { bySortOrder } from '../utils/sort-order'
import { startOfToday } from '../utils/date'
import { buildList, type ListBuildContext, type ListContents } from './build-list'
import type { CopyTaskSection } from './task-copy'
import type { TaskDialogPayload, TaskDialogSource } from '../stores/task-dialog-payload'
import { useFilterStore } from '../stores/filter-store'
import { currentAppliedLens, currentScreenFilter } from '../stores/screen-filter'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { useListOrderStore } from '../stores/list-order-store'
import { usePersonStore } from '../stores/person-store'
import { currentFilterSettings, useSettingsStore } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'

/**
 * The task dialog: the tasks behind a number (a dashboard count) or an
 * attribute (a person chip), as a modal list. A payload says what to show
 * and in words what was counted; its source is resolved to rows once, when
 * the dialog opens, so rows stay in place (a completed one struck through)
 * until it closes — or, for the screen filter's tasks, until that filter
 * changes.
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
  /** The top-bar filter (list and screen sources compose it in). */
  screen: FilterCriteria
  listRanks: ReadonlyMap<number, ListRanks>
  /** Settings' sort and grouping for a new list: how the screen filter's tasks are shown. */
  newListView: NewListView
}

/** Settings' new-list sort, its direction and grouping (`newListSort` / `newListSortDirection` / `newListGroup`). */
export interface NewListView {
  sort: TodoSortBy
  sortDirection: TodoSortDirection
  grouping: TodoGroupBy
}

/** The stores as they are now: what a source is resolved with. */
export function currentTaskDialogEnv(): TaskDialogEnv {
  const drafts = useListDraftStore.getState().drafts
  const people = usePersonStore.getState()
  const tags = useTagStore.getState()
  const settings = useSettingsStore.getState()
  return {
    todos: useTodoStore.getState().todos,
    today: startOfToday(),
    weekStartsOn: settings.weekStartsOn,
    markerSettings: currentFilterSettings(),
    assignedPeopleMap: people.assignedPeopleMap,
    assignedTagsMap: tags.assignedTagsMap,
    people: people.people,
    statuses: useStatusStore.getState().statuses,
    listDefinitions: useListDefinitionStore.getState().listDefinitions.map((d) => drafts[d.id] ?? d),
    screen: currentScreenFilter(),
    listRanks: useListOrderStore.getState().ranks,
    newListView: { sort: settings.newListSort, sortDirection: settings.newListSortDirection, grouping: settings.newListGroup },
  }
}

function lookupsOf(env: Pick<TaskDialogEnv, 'assignedPeopleMap' | 'assignedTagsMap' | 'statuses'>): TodoNameLookups {
  return {
    assignedPeopleMap: env.assignedPeopleMap,
    assignedTagsMap: env.assignedTagsMap,
    statusesById: new Map(env.statuses.map((s) => [s.id!, s])),
  }
}

function filterSettingsOf(env: Pick<TaskDialogEnv, 'markerSettings' | 'weekStartsOn'>): FilterSettings {
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
      return groupsOfList(buildList(def, env.todos, { ...listBuildContext(env), ranks: env.listRanks.get(def.id) ?? new Map() }))
    }
    case 'screen':
      // No manual order of its own: a Manual sort is the tasks' `sortOrder`.
      return groupsOfList(buildList(screenListDefinition(env.newListView), env.todos, listBuildContext(env)))
  }
}

/** What a list is built with in the dialog: the screen filter composed in. */
function listBuildContext(env: TaskDialogEnv): ListBuildContext {
  return {
    today: env.today,
    weekStartsOn: env.weekStartsOn,
    evalPredicate: createScreenComposedEvaluator(env.screen, lookupsOf(env), env.today, filterSettingsOf(env)),
    assignedPeopleMap: env.assignedPeopleMap,
    assignedTagsMap: env.assignedTagsMap,
    people: env.people,
    statuses: env.statuses,
    urgentRange: env.markerSettings.urgentRange,
    hotRule: env.markerSettings.hotRule,
  }
}

/** A built list's sections as headings; one flat group when it isn't grouped. */
function groupsOfList(list: ListContents): TaskDialogRowGroup[] {
  const sections = list.sections
  const grouped = !(sections.length === 1 && sections[0]?.key === 'all')
  return sections.map((s) => ({
    key: s.key,
    label: grouped ? s.label : null,
    ...(grouped && s.accentColor ? { color: s.accentColor } : {}),
    todoIds: s.todos.map((t) => t.id),
  }))
}

const SCREEN_DIALOG_TITLE = 'Filtered tasks'

/** What the screen filter's tasks are matched against: every open task (the filter's Show completed adds the rest). */
const OPEN_TASKS = emptyPredicate()

/**
 * The list the screen filter's tasks are shown as: every open task, the
 * screen filter composed in (narrowing it; its Show completed adding the
 * completed ones), with Settings' new-list sort and grouping.
 */
function screenListDefinition(view: NewListView): PersistedListDefinition {
  return {
    id: 0,
    name: SCREEN_DIALOG_TITLE,
    sortOrder: 0,
    membership: { kind: 'custom', predicate: OPEN_TASKS },
    sort: view.sort,
    ...(view.sortDirection === 'desc' ? { sortDirection: view.sortDirection } : {}),
    grouping: view.grouping,
  }
}

/** What `screenTaskCount` reads. */
export type ScreenCountEnv = Pick<TaskDialogEnv,
  'todos' | 'today' | 'weekStartsOn' | 'markerSettings' | 'assignedPeopleMap' | 'assignedTagsMap' | 'statuses' | 'screen'>

/** How many tasks the screen filter's dialog lists: open ones the filter matches (completed too under its Show completed). */
export function screenTaskCount(env: ScreenCountEnv): number {
  const matches = createScreenComposedEvaluator(env.screen, lookupsOf(env), env.today, filterSettingsOf(env))
  let n = 0
  for (const t of env.todos) if (matches(OPEN_TASKS, t)) n++
  return n
}

/** The top bar's counter: what the screen filter (chips and lens) keeps of every task it can show. */
export interface ScreenTaskCounts {
  /** What the dialog lists (`screenTaskCount`). */
  shown: number
  /** Every open task (completed too under Show completed): the `of N`. */
  total: number
  /** What the lens alone keeps of `total` (`total` without a lens). */
  lensKeeps: number
}

/** The screen filter's counts (`ScreenTaskCounts`). */
export function screenTaskCounts(env: ScreenCountEnv): ScreenTaskCounts {
  const { screen } = env
  const settings = filterSettingsOf(env)
  const lookups = lookupsOf(env)
  const everything: FilterCriteria = { ...predicateToCriteria(OPEN_TASKS), showCompleted: screen.showCompleted }
  const shown = createScreenComposedEvaluator(screen, lookups, env.today, settings)
  const all = createScreenComposedEvaluator(everything, lookups, env.today, settings)
  const lens = screen.lens ? createScreenComposedEvaluator({ ...everything, lens: screen.lens }, lookups, env.today, settings) : null
  const counts = { shown: 0, total: 0, lensKeeps: 0 }
  for (const t of env.todos) {
    if (!all(OPEN_TASKS, t)) continue
    counts.total++
    if (!lens || lens(OPEN_TASKS, t)) counts.lensKeeps++
    if (shown(OPEN_TASKS, t)) counts.shown++
  }
  return counts
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
  /** The Eisenhower's list's name while its filter narrows the tasks; `null` = every task. */
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

/** The screen filter's tasks (the top bar's Show N tasks, the palette); the dialog edits that filter live. */
export function screenTaskDialog(): TaskDialogPayload {
  const lens = currentAppliedLens()
  return {
    title: SCREEN_DIALOG_TITLE,
    glyph: 'filter',
    description: screenTaskDialogDescription(useFilterStore.getState().filters, lens && { name: lens.name, counts: screenTaskCounts(currentTaskDialogEnv()) }),
    source: { kind: 'screen' },
  }
}

/** The button that opens it: `Show 1 task`, `Show 12 tasks`. */
export function showTasksLabel(n: number): string {
  return `Show ${n} ${n === 1 ? 'task' : 'tasks'}`
}

/**
 * What the screen filter's dialog shows, in words, for the filter as it is
 * (the dialog keeps it current): `chips` = the top bar's chips; `lens` = the
 * top bar's lens as it applies (its name and the counts), if any.
 */
export function screenTaskDialogDescription(chips: FilterCriteria, lens?: { name: string; counts: ScreenTaskCounts }): string {
  const tasks = chips.showCompleted ? 'tasks' : 'open tasks'
  if (lens) {
    const { shown, total, lensKeeps } = lens.counts
    if (countActiveFilters({ ...chips, showCompleted: false }) === 0) {
      return `${shown} of ${total} ${tasks} shown: the lens “${lens.name}” hides ${total - lensKeeps}. A filter set here applies to every widget, on top of the lens.`
    }
    return `${shown} of ${total} ${tasks} match the filter under the lens “${lens.name}”. A change here applies to every widget.`
  }
  if (countActiveFilters(chips) === 0) return 'Every open task: no screen filter is on. A filter set here applies to every widget.'
  const what = chips.showCompleted ? 'Tasks matching the screen filter, completed ones included.' : 'Open tasks matching the screen filter.'
  return `${what} A change here applies to every widget.`
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
