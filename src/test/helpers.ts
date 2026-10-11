import type { PersistedTodoItem, Person, Project, Org } from '../models'
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
import { useFloatingStatusStore } from '../stores/floating-status-store'
import { useListInsetStore } from '../stores/list-inset-store'

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
  hasFollowup: null,
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
  useFloatingStatusStore.setState({ statuses: [], loading: false, error: null })
  useListInsetStore.setState({ insets: [], loading: false, error: null })
}

/**
 * Dexie store specs of the v52 schema, for tests that build an old database
 * by hand and then open it with the real `Todo2Database`. v53 changed no store
 * spec, so this is the current schema. Update when a later version changes a
 * store spec (add back what it drops / alters).
 */
export function v52StoreSpecs(): Record<string, string> {
  return Object.fromEntries(db.tables.map((t) => {
    const indexes = t.schema.indexes.map((i) => i.src)
    return [t.name, [t.schema.primKey.src, ...indexes].join(', ')]
  }))
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
