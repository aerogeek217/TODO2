import type { PersistedTodoItem, Person, Status, Tag, TodoItem } from '../models'
import type { FilterCriteria } from '../utils/filter-criteria'
import { applyFilter, matchesFilter, type FilterSettings } from '../utils/filter-match'
import { todoNameLookups, type TextMatchContext, type TodoNameLookups, type TodoNameSources } from '../utils/filter'
import { startOfToday } from '../utils/date'
import { currentFilterSettings } from '../stores/settings-store'
import { db } from '../data/database'
import { useFilterStore } from '../stores/filter-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'

/**
 * A clipboard for rich copies (`navigator.clipboard.write` + `ClipboardItem`;
 * jsdom has neither): `written` holds the plain text of each write, in order.
 * The shared project's file reset removes it again.
 */
export function stubClipboard(): { written: string[] } {
  const written: string[] = []
  const write = async (items: Array<{ data: Record<string, Blob> }>) => {
    const plain = items[0]?.data['text/plain']
    written.push(plain ? await plain.text() : '')
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText: async () => {} } })
  class StubClipboardItem {
    constructor(public data: unknown) {}
  }
  ;(globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem = StubClipboardItem
  return { written }
}

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

export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}

/** Default empty filter shape — mirrors `defaultFilters` inside filter-store. */
export const emptyFilterCriteria: FilterCriteria = {
  showCompleted: false,
  personIds: null,
  statusIds: null,
  searchText: '',
  dates: {},
  markers: null,
  tags: null,
}

/** `matchesFilter` with today and the store's current settings filled in when omitted. */
export function matchesFilterNow(
  filters: FilterCriteria,
  todo: TodoItem,
  assignedPersonIds?: number[],
  today: Date = startOfToday(),
  searchCtx?: TextMatchContext,
  assignedTagIds?: number[],
  settings: FilterSettings = currentFilterSettings(),
): boolean {
  return matchesFilter(filters, todo, assignedPersonIds, today, searchCtx, assignedTagIds, settings)
}

/** `applyFilter` with today and the store's current settings filled in when omitted. */
export function applyFilterNow(
  filters: FilterCriteria,
  todos: PersistedTodoItem[],
  assignedPeopleMap?: Map<number, Person[]>,
  statuses?: Status[],
  today: Date = startOfToday(),
  assignedTagsMap?: Map<number, Tag[]>,
  settings: FilterSettings = currentFilterSettings(),
): PersistedTodoItem[] {
  return applyFilter(filters, todos, testLookups({ assignedPeopleMap, statuses, assignedTagsMap }), today, settings)
}

/** The search lookups (`todoNameLookups`) over what a test gives, every other map empty. */
export function testLookups(sources: Partial<{ [K in keyof TodoNameSources]: TodoNameSources[K] | undefined }> = {}): TodoNameLookups {
  return todoNameLookups({
    assignedPeopleMap: sources.assignedPeopleMap ?? new Map(),
    assignedTagsMap: sources.assignedTagsMap ?? new Map(),
    statuses: sources.statuses ?? [],
    statusUpdatesByTodo: sources.statusUpdatesByTodo ?? new Map(),
    subtasksByTodo: sources.subtasksByTodo ?? new Map(),
  })
}

/** `TodoNameLookups` with the given maps (by id, as the evaluator reads them), every other map empty. */
export function lookupsFor(partial: Partial<TodoNameLookups> = {}): TodoNameLookups {
  return {
    assignedPeopleMap: new Map(),
    assignedTagsMap: new Map(),
    statusesById: new Map(),
    statusUpdatesByTodo: new Map(),
    subtasksByTodo: new Map(),
    ...partial,
  }
}

/** Sets some fields of the screen filter, keeping the rest. */
export function patchScreenFilter(patch: Partial<FilterCriteria>): void {
  const store = useFilterStore.getState()
  store.setAllFilters({ ...store.filters, ...patch })
}

/** Reset filter store to its empty state. Wraps the store's clearAll() for grep-ability. */
export function clearFilterStore(): void {
  useFilterStore.getState().clearAll()
}

/**
 * Reset the entity stores (todos, people, statuses, tags).
 * Each entity flag defaults to true; pass an opt-out for the ones you want to
 * keep mid-test (e.g. `resetEntityStores({ statuses: false })` if the suite
 * pre-seeds statuses outside the helper).
 */
export function resetEntityStores(opts: {
  todos?: boolean
  people?: boolean
  statuses?: boolean
  tags?: boolean
} = {}): void {
  const {
    todos = true,
    people = true,
    statuses = true,
    tags = true,
  } = opts
  if (todos) useTodoStore.setState({ todos: [] })
  if (people) usePersonStore.setState({ people: [], assignedPeopleMap: new Map() })
  if (statuses) useStatusStore.setState({ statuses: [] })
  if (tags) useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
}
