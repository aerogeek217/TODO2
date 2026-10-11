import type { PersistedTodoItem, Person, Project } from '../models'
import type { FilterCriteria } from '../stores/filter-store'
import { db } from '../data/database'
import { useFilterStore } from '../stores/filter-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useProjectStore } from '../stores/project-store'
import { useTagStore } from '../stores/tag-store'

let makeTodoUidSeq = 0

export function makeTodo(
  overrides: Partial<PersistedTodoItem> & { id?: number } = {},
): PersistedTodoItem {
  return {
    uid: `test-uid-${++makeTodoUidSeq}`,
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

export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}

/** Default empty filter shape — mirrors `defaultFilters` inside filter-store. */
export const emptyFilterCriteria: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  projectIds: null,
  statusIds: null,
  searchText: '',
  dateField: 'deadline',
  dateRangeStart: null,
  dateRangeEnd: null,
  dateRangeIncludeNoDate: false,
  hasDeadline: null,
  hasFollowup: null,
  tags: null,
}

/** Reset filter store to its empty state. Wraps the store's clearAll() for grep-ability. */
export function clearFilterStore(): void {
  useFilterStore.getState().clearAll()
}

/**
 * Reset the entity stores (todos, people, statuses, projects, tags).
 * Each entity flag defaults to true; pass an opt-out for the ones you want to
 * keep mid-test (e.g. `resetEntityStores({ statuses: false })` if the suite
 * pre-seeds statuses outside the helper).
 */
export function resetEntityStores(opts: {
  todos?: boolean
  people?: boolean
  statuses?: boolean
  projects?: boolean
  tags?: boolean
} = {}): void {
  const {
    todos = true,
    people = true,
    statuses = true,
    projects = true,
    tags = true,
  } = opts
  if (todos) useTodoStore.setState({ todos: [] })
  if (people) usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  if (statuses) useStatusStore.setState({ statuses: [] })
  if (projects) useProjectStore.setState({ projects: [] })
  if (tags) useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
}

/**
 * Dexie store specs of the current schema, for tests that build an old
 * database by hand and then open it with the real `Todo2Database`.
 */
function currentStoreSpecs(): Record<string, string> {
  return Object.fromEntries(db.tables.map((t) => {
    const indexes = t.schema.indexes.map((i) => i.src)
    return [t.name, [t.schema.primKey.src, ...indexes].join(', ')]
  }))
}

/**
 * Store specs of the v58 schema: the current specs plus the taskboard stores
 * v59 dropped. Update when a later version changes a store spec (add back
 * what it drops / alters, remove what it adds).
 */
export function v58StoreSpecs(): Record<string, string> {
  return {
    ...currentStoreSpecs(),
    taskboards: '++id',
    floatingTaskboards: '++id, canvasId',
  }
}

/** Store specs of the v57 schema: v58's minus the `listOrders` store v58 added. */
export function v57StoreSpecs(): Record<string, string> {
  const specs = v58StoreSpecs()
  delete specs.listOrders
  return specs
}

/** Store specs of the v56 schema — v57 changed no store spec. */
export function v56StoreSpecs(): Record<string, string> {
  return v57StoreSpecs()
}

/** Store specs of the v55 schema: v56's minus the `layouts` store v56 added. */
export function v55StoreSpecs(): Record<string, string> {
  const specs = v56StoreSpecs()
  delete specs.layouts
  return specs
}

/** Store specs of the v54 schema: v55's plus the org stores v55 dropped. */
export function v54StoreSpecs(): Record<string, string> {
  return {
    ...v55StoreSpecs(),
    orgs: '++id, name',
    todoOrgs: '++id, todoId, orgId',
    personOrgs: '++id, personId, orgId',
  }
}

/** Store specs of the v52 schema — v53 and v54 changed no store spec. */
export function v52StoreSpecs(): Record<string, string> {
  return v54StoreSpecs()
}

/**
 * Store specs of the v51 schema: v52's plus the stores v52 dropped (the
 * horizons / scoreboard / snooze-graveyard placement tables).
 */
export function v51StoreSpecs(): Record<string, string> {
  return {
    ...v52StoreSpecs(),
    floatingHorizons: '++id, canvasId',
    floatingScoreboard: '++id, canvasId',
    floatingSnoozeGraveyard: '++id, canvasId',
  }
}

/** Store specs of the v49 / v50 schema: v51's minus the `todos.&uid` index. */
export function v50StoreSpecs(): Record<string, string> {
  const specs = v51StoreSpecs()
  specs.todos = (specs.todos ?? '').split(', ').filter((src) => src !== '&uid').join(', ')
  return specs
}
