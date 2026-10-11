import type { Person, Status, Tag } from '../models'

/**
 * Toggle an item in a null-or-Set filter.
 * null = all shown. Set = explicit selection.
 * Toggling from null creates a set of all-except-item.
 * If toggling back produces all items, returns null (= all).
 */
export function toggleItem<T>(current: Set<T> | null, item: T, allItems: T[]): Set<T> | null {
  if (current === null) {
    return new Set(allItems.filter((x) => x !== item))
  }
  const next = new Set(current)
  if (next.has(item)) {
    next.delete(item)
  } else {
    next.add(item)
    if (next.size >= allItems.length) return null
  }
  return next
}

/** Field kinds that a text search can hit. Ordered so UI groupings render consistently. */
export type TextMatchField = 'title' | 'notes' | 'person' | 'status' | 'tag'

export const TEXT_MATCH_FIELDS: readonly TextMatchField[] = [
  'title', 'notes', 'person', 'status', 'tag',
] as const

/**
 * Resolved names for the fields beyond `title`/`notes` (which live on the
 * todo itself). Callers resolve each field from its source-of-truth store —
 * e.g. `tagNames` from `assignedTagsMap.get(todoId)?.map(t => t.name)`, not
 * from the legacy inline `todo.tags` field.
 */
export interface TextMatchContext {
  personNames?: string[]
  statusName?: string
  tagNames?: string[]
}

/**
 * Per-todo name lookups for {@link textMatchContextFor}. Every surface that
 * searches tasks resolves names from these same maps, so a query hits the
 * same tasks in the list page, list widgets and the top-bar search.
 */
export interface TodoNameLookups {
  assignedPeopleMap?: ReadonlyMap<number, readonly Person[]>
  assignedTagsMap?: ReadonlyMap<number, readonly Tag[]>
  statusesById?: ReadonlyMap<number, Status>
}

/** Resolve the person / status / tag names a text search can hit. */
export function textMatchContextFor(
  todo: { id: number; statusId?: number },
  lookups: TodoNameLookups,
): TextMatchContext {
  return {
    personNames: (lookups.assignedPeopleMap?.get(todo.id) ?? []).map((p) => p.name),
    statusName: todo.statusId != null ? lookups.statusesById?.get(todo.statusId)?.name : undefined,
    tagNames: (lookups.assignedTagsMap?.get(todo.id) ?? []).map((t) => t.name),
  }
}

export interface TextMatchResult {
  matched: boolean
  fields: TextMatchField[]
}

/**
 * Case-insensitive substring match across the todo's text-bearing fields. An
 * empty query matches everything with no fields reported. `ctx` is optional:
 * callers that can't cheaply resolve names pass `undefined` and get title/notes
 * matching only.
 */
export function matchTodoText(
  todo: { title?: string; notes?: string },
  query: string,
  ctx?: TextMatchContext,
): TextMatchResult {
  const q = query.toLowerCase().trim()
  if (!q) return { matched: true, fields: [] }
  const fields: TextMatchField[] = []
  if (todo.title && todo.title.toLowerCase().includes(q)) fields.push('title')
  if (todo.notes && todo.notes.toLowerCase().includes(q)) fields.push('notes')
  if (ctx?.personNames && ctx.personNames.some(n => n.toLowerCase().includes(q))) fields.push('person')
  if (ctx?.statusName && ctx.statusName.toLowerCase().includes(q)) fields.push('status')
  if (ctx?.tagNames && ctx.tagNames.some(n => n.toLowerCase().includes(q))) fields.push('tag')
  return { matched: fields.length > 0, fields }
}

/**
 * Buckets todos by every text field the query hits (a todo matching several
 * fields appears in each of those groups). Within each group, incomplete todos
 * come first and completed todos sink to the bottom; relative order inside
 * each half follows the input order (stable partition). Drives the TopBar
 * grouped search dropdown.
 */
export function groupTodosByTextMatch<T extends { title?: string; notes?: string; isCompleted: boolean }>(
  todos: readonly T[],
  query: string,
  ctxFor: (todo: T) => TextMatchContext | undefined,
): Record<TextMatchField, T[]> {
  const groups: Record<TextMatchField, T[]> = {
    title: [], notes: [], person: [], status: [], tag: [],
  }
  const completed: Record<TextMatchField, T[]> = {
    title: [], notes: [], person: [], status: [], tag: [],
  }
  for (const t of todos) {
    const { fields } = matchTodoText(t, query, ctxFor(t))
    const target = t.isCompleted ? completed : groups
    for (const f of fields) target[f].push(t)
  }
  for (const f of TEXT_MATCH_FIELDS) groups[f].push(...completed[f])
  return groups
}
