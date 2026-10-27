import type { EisenhowerPanes } from '../models/eisenhower-settings'
import type { TodoPredicate } from '../models/filter-predicate'
import type { ListDefinition } from '../models/list-definition'
import { byName } from './sort-order'

/**
 * Unused people and tags (Settings › People, statuses & tags › Unused people
 * & tags): which entries no task carries — or, ignoring completed tasks, only
 * completed ones do — and which filters still name them. Pure: the caller
 * passes every task and every task's assignments.
 */

/** The tasks carrying one person / tag: how many are open, and the completed ones' ids. */
export interface EntityTaskUse {
  open: number
  completedTodoIds: number[]
}

/** Entity id → the tasks carrying it, over `todos` only (a join to a task not in `todos` — deleted — counts for nothing). */
export function entityTaskUse<E extends { id?: number }>(
  todos: ReadonlyArray<{ id: number; isCompleted: boolean }>,
  assignedMap: ReadonlyMap<number, readonly E[]>,
): Map<number, EntityTaskUse> {
  const use = new Map<number, EntityTaskUse>()
  for (const todo of todos) {
    for (const entity of assignedMap.get(todo.id) ?? []) {
      if (entity.id == null) continue
      let entry = use.get(entity.id)
      if (!entry) {
        entry = { open: 0, completedTodoIds: [] }
        use.set(entity.id, entry)
      }
      if (todo.isCompleted) entry.completedTodoIds.push(todo.id)
      else entry.open += 1
    }
  }
  return use
}

/** Where one person / tag is named in a filter: how many lists, how many Eisenhower panes, the check-in filter. */
export interface FilterRefs {
  lists: number
  panes: number
  checkin: boolean
}

/** The stored filters that can name people and tags. */
export interface FilterSources {
  /** Every list — the layouts' and the Eisenhower's own. */
  lists: readonly ListDefinition[]
  /** Unsaved edits by list id: a list counts once whether its saved filter or its draft names the entry. */
  drafts?: Readonly<Record<number, ListDefinition>>
  /** The app-wide Eisenhower panes as stored (a pane without a filter of its own names nobody). */
  panes: EisenhowerPanes
  checkinFilter: TodoPredicate
}

type EntityField = 'personIds' | 'tags'

/**
 * The ids a predicate's People / Tags clauses name — its own and its or
 * groups' —, "is" or "is not" (0 — unassigned / no tag — is no entry).
 */
function namedIds(predicate: TodoPredicate | undefined, field: EntityField): number[] {
  if (!predicate) return []
  return [predicate, ...(predicate.orGroups ?? [])].flatMap((c) => (c[field] ?? []).filter((id) => id > 0))
}

/** Entity id → where the filters name it; an entry no filter names is absent. */
export function filterReferences(sources: FilterSources, kind: 'person' | 'tag'): Map<number, FilterRefs> {
  const field: EntityField = kind === 'person' ? 'personIds' : 'tags'
  const refs = new Map<number, FilterRefs>()
  const at = (id: number): FilterRefs => {
    let r = refs.get(id)
    if (!r) {
      r = { lists: 0, panes: 0, checkin: false }
      refs.set(id, r)
    }
    return r
  }
  for (const list of sources.lists) {
    const draft = list.id != null ? sources.drafts?.[list.id] : undefined
    const ids = new Set([
      ...namedIds(list.membership.predicate, field),
      ...namedIds(draft?.membership.predicate, field),
    ])
    for (const id of ids) at(id).lists += 1
  }
  for (const pane of Object.values(sources.panes)) {
    for (const id of new Set(namedIds(pane.filter, field))) at(id).panes += 1
  }
  for (const id of new Set(namedIds(sources.checkinFilter, field))) at(id).checkin = true
  return refs
}

export function isNamedInFilter(refs: FilterRefs | undefined): boolean {
  return refs != null && (refs.lists > 0 || refs.panes > 0 || refs.checkin)
}

/** One unused person / tag as the Settings part lists it. */
export interface UnusedEntry<E> {
  id: number
  entity: E
  /** The completed tasks carrying it (empty unless completed tasks are ignored). */
  completedTodoIds: readonly number[]
  /** Where filters name it; absent when none does. */
  refs?: FilterRefs
}

/**
 * The entries no task carries — with `ignoreCompleted`, also those only
 * completed tasks carry — by name.
 */
export function findUnused<E extends { id?: number; name: string }>(
  entities: readonly E[],
  use: ReadonlyMap<number, EntityTaskUse>,
  refs: ReadonlyMap<number, FilterRefs>,
  ignoreCompleted: boolean,
): UnusedEntry<E>[] {
  const out: UnusedEntry<E>[] = []
  for (const entity of entities) {
    if (entity.id == null) continue
    const u = use.get(entity.id)
    const open = u?.open ?? 0
    const completed = u?.completedTodoIds ?? []
    if (open > 0 || (!ignoreCompleted && completed.length > 0)) continue
    const r = refs.get(entity.id)
    out.push({ id: entity.id, entity, completedTodoIds: completed, ...(r ? { refs: r } : {}) })
  }
  return out.sort((a, b) => byName(a.entity, b.entity))
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A row's note: `on 2 completed tasks · in 2 list filters · in an Eisenhower pane · in the check-in filter`, or `''`. */
export function unusedEntryNote(entry: UnusedEntry<unknown>): string {
  const parts: string[] = []
  const done = entry.completedTodoIds.length
  if (done > 0) parts.push(`on ${count(done, 'completed task', 'completed tasks')}`)
  const r = entry.refs
  if (r) {
    if (r.lists > 0) parts.push(r.lists === 1 ? 'in a list filter' : `in ${r.lists} list filters`)
    if (r.panes > 0) parts.push(r.panes === 1 ? 'in an Eisenhower pane' : `in ${r.panes} Eisenhower panes`)
    if (r.checkin) parts.push('in the check-in filter')
  }
  return parts.join(' · ')
}

/** `3 people and 2 tags` / `1 person` / `2 tags`. */
export function peopleAndTags(people: number, tags: number): string {
  const p = count(people, 'person', 'people')
  const t = count(tags, 'tag', 'tags')
  if (people > 0 && tags > 0) return `${p} and ${t}`
  return people > 0 ? p : t
}

/** The undo step's name: `Remove 3 people and 2 tags`. */
export function removeEntitiesDescription(people: number, tags: number): string {
  return `Remove ${peopleAndTags(people, tags)}`
}

/**
 * The confirm's lines for removing the ticked entries: the question, what
 * completed tasks lose them (distinct tasks), how many filters name them,
 * and that it can be undone.
 */
export function removeConfirmLines(
  people: ReadonlyArray<UnusedEntry<unknown>>,
  tags: ReadonlyArray<UnusedEntry<unknown>>,
): { question: string; completed: string | null; filters: string | null; undo: string } {
  const all = [...people, ...tags]
  const one = all.length === 1
  const completedTasks = new Set(all.flatMap((e) => e.completedTodoIds)).size
  const named = all.filter((e) => isNamedInFilter(e.refs)).length
  return {
    question: `${removeEntitiesDescription(people.length, tags.length)}?`,
    completed: completedTasks > 0
      ? `${one ? 'It’s' : 'They’re'} removed from ${count(completedTasks, 'completed task', 'completed tasks')}.`
      : null,
    filters: named === 0
      ? null
      : named === 1
        ? `1 is named in filters, which will stop matching it.`
        : `${named} are named in filters, which will stop matching them.`,
    undo: 'You can undo this.',
  }
}
