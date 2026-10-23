import type { PersistedTodoItem, Person, Status, Tag, TodoItem } from '../models'
import type { FilterCriteria } from '../utils/filter-criteria'
import { applyFilter, matchesFilter, type FilterSettings } from '../utils/filter-match'
import type { TextMatchContext } from '../utils/filter'
import { startOfToday } from '../utils/date'
import { currentFilterSettings } from '../stores/settings-store'
import { db } from '../data/database'
import { useFilterStore } from '../stores/filter-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { blockedPaneLines, resolvePaneDrop, type PaneChange, type PaneContext } from '../utils/eisenhower'
import { resolvePanes } from '../utils/eisenhower-panes'
import type { EisenhowerQuadrant } from '../models/workspace-layout'
import { DEFAULT_HOT_RULE } from '../utils/hot'
import type { UrgentDueWithinDays } from '../utils/urgency'
import type { StatsContext } from '../services/stats/stats-context'

/**
 * An Eisenhower pane context for tests: `today`, the urgent `range`, the
 * default Hot rule and week start; no people / tags / statuses unless given.
 */
export function makePaneContext(today: Date, range: UrgentDueWithinDays, extra: Partial<PaneContext> = {}): PaneContext {
  return {
    today,
    settings: { urgentRange: range, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 0 },
    assignedPeopleMap: new Map(),
    assignedTagsMap: new Map(),
    people: [],
    tags: [],
    statuses: [],
    ...extra,
  }
}

/**
 * The pane context a dashboard statistic's context (`StatsContext`) gives
 * — what the Eisenhower summary classifies with in tests.
 */
export function statsPaneContext(ctx: StatsContext, extra: Partial<PaneContext> = {}): PaneContext {
  return makePaneContext(ctx.today, ctx.urgentRange, {
    settings: { urgentRange: ctx.urgentRange, hotRule: ctx.hotRule, weekStartsOn: ctx.weekStartsOn },
    assignedPeopleMap: ctx.assignedPeopleMap,
    assignedTagsMap: ctx.assignedTagsMap,
    statuses: ctx.statuses,
    ...extra,
  })
}

/**
 * `resolvePaneDrop` on the default panes, in their terms (the blocked tasks
 * without their reasons) — the default quadrants' drop rules, for tests.
 */
export function resolveQuadrantDrop<T extends PersistedTodoItem>(
  todos: readonly T[],
  target: EisenhowerQuadrant,
  today: Date,
  range: UrgentDueWithinDays,
):
  | { kind: 'none' }
  | { kind: 'blocked'; blocked: T[] }
  | { kind: 'apply'; changes: PaneChange[] } {
  const res = resolvePaneDrop(todos, target, resolvePanes(undefined), makePaneContext(today, range))
  if (res.kind === 'blocked') return { kind: 'blocked', blocked: res.blocked.map((b) => b.task) }
  return res
}

/** `blockedPaneLines` for default-pane drops refused by due dates (`Can’t move to Drop` / why / what to change). */
export function blockedDropLines(
  target: EisenhowerQuadrant,
  blocked: readonly PersistedTodoItem[],
  total: number,
  today: Date,
  range: UrgentDueWithinDays,
): [string, string, string] {
  const panes = resolvePanes(undefined)
  const pane = panes.find((p) => p.id === target)
  if (!pane) throw new Error(`no pane ${target}`)
  const ctx = makePaneContext(today, range)
  return blockedPaneLines(pane, blocked.map((task) => ({ task, miss: { kind: 'urgent-date' as const } })), total, panes, ctx, ctx)
}

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
  return applyFilter(filters, todos, assignedPeopleMap, statuses, today, assignedTagsMap, settings)
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
