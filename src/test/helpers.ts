import type { PersistedTodoItem, Person, Project, Org, ScheduledValue } from '../models'
import type { FilterCriteria } from '../stores/filter-store'
import { db } from '../data/database'
import { useFilterStore } from '../stores/filter-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useOrgStore } from '../stores/org-store'
import { useStatusStore } from '../stores/status-store'
import { useProjectStore } from '../stores/project-store'
import { useTagStore } from '../stores/tag-store'
import { useCanvasRailsStore } from '../stores/canvas-rails-store'
import { EMPTY_RAILS } from '../models/canvas-rails'
import { useFloatingNoteStore } from '../stores/floating-note-store'
import { useFloatingCalendarStore } from '../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../stores/floating-taskboard-store'
import { useFloatingHorizonsStore } from '../stores/floating-horizons-store'
import { useFloatingStatusStore } from '../stores/floating-status-store'
import { useFloatingScoreboardStore } from '../stores/floating-scoreboard-store'
import { useFloatingSnoozeGraveyardStore } from '../stores/floating-snooze-graveyard-store'
import { useListInsetStore } from '../stores/list-inset-store'

export function makeTodo(
  overrides: Partial<PersistedTodoItem> & { id?: number; scheduledDate?: ScheduledValue } = {},
): PersistedTodoItem {
  return {
    title: overrides.id != null ? `Task ${overrides.id}` : 'Task',
    isCompleted: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: overrides.id ?? 0,
    ...overrides,
  } as PersistedTodoItem
}

export function makePerson(overrides: Partial<Person> & { id: number }): Person & { id: number } {
  return {
    name: `Person ${overrides.id}`,
    initials: `P${overrides.id}`,
    ...overrides,
  }
}

export function makeProject(overrides: Partial<Project> & { id: number; canvasId: number }): Project & { id: number } {
  return {
    name: `Project ${overrides.id}`,
    positionX: 0,
    positionY: 0,
    isCollapsed: false,
    sortOrder: overrides.id,
    createdAt: new Date(),
    ...overrides,
  }
}

export function makeOrg(overrides: Partial<Org> & { id: number }): Org & { id: number } {
  return {
    name: `Org ${overrides.id}`,
    ...overrides,
  }
}

export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}

/** Default empty filter shape — mirrors `defaultFilters` inside filter-store. */
export const emptyFilterCriteria: FilterCriteria = {
  showCompleted: false,
  showHiddenStatuses: false,
  personIds: null,
  personFilterMode: 'include-orgs',
  orgIds: null,
  orgFilterMode: 'include-people',
  projectIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'date',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasScheduled: null,
  hasDeadline: null,
  tags: null,
}

/** Reset filter store to its empty state. Wraps the store's clearAll() for grep-ability. */
export function clearFilterStore(): void {
  useFilterStore.getState().clearAll()
}

/**
 * Reset the entity stores (todos, people, orgs, statuses, projects, tags).
 * Each entity flag defaults to true; pass an opt-out for the ones you want to
 * keep mid-test (e.g. `resetEntityStores({ statuses: false })` if the suite
 * pre-seeds statuses outside the helper).
 */
export function resetEntityStores(opts: {
  todos?: boolean
  people?: boolean
  orgs?: boolean
  statuses?: boolean
  projects?: boolean
  tags?: boolean
} = {}): void {
  const {
    todos = true,
    people = true,
    orgs = true,
    statuses = true,
    projects = true,
    tags = true,
  } = opts
  if (todos) useTodoStore.setState({ todos: [] })
  if (people) usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  if (orgs) useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map() })
  if (statuses) useStatusStore.setState({ statuses: [] })
  if (projects) useProjectStore.setState({ projects: [] })
  if (tags) useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
}

/** Reset the canvas-rails store to its empty + un-hydrated state. Pass
 * `{ hydrated: true }` for tests that exercise post-hydration behavior. */
export function resetRailsStore(opts: { hydrated?: boolean } = {}): void {
  useCanvasRailsStore.setState({
    rails: EMPTY_RAILS,
    hydrated: opts.hydrated ?? false,
    pendingFocusSlotId: null,
  })
}

/** Reset every per-canvas float store + the lens (`listInset`) store. Mirrors
 * the inline reset block several test files used to repeat. */
export function resetFloatingStores(): void {
  useFloatingNoteStore.setState({ notes: [], loading: false, error: null })
  useFloatingCalendarStore.setState({ calendars: [], loading: false, error: null })
  useFloatingTaskboardStore.setState({ taskboards: [], loading: false, error: null })
  useFloatingHorizonsStore.setState({ horizons: [], loading: false, error: null })
  useFloatingStatusStore.setState({ statuses: [], loading: false, error: null })
  useFloatingScoreboardStore.setState({ scoreboards: [], loading: false, error: null })
  useFloatingSnoozeGraveyardStore.setState({ graveyards: [], loading: false, error: null })
  useListInsetStore.setState({ insets: [], loading: false, error: null })
}
