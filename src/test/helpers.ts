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
