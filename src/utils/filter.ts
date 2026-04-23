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
export type TextMatchField = 'title' | 'notes' | 'project' | 'person' | 'org' | 'status' | 'tag'

export const TEXT_MATCH_FIELDS: readonly TextMatchField[] = [
  'title', 'notes', 'project', 'person', 'org', 'status', 'tag',
] as const

/**
 * Resolved names for the fields beyond `title`/`notes` (which live on the
 * todo itself). Callers resolve each field from its source-of-truth store —
 * e.g. `tagNames` from `assignedTagsMap.get(todoId)?.map(t => t.name)`, not
 * from the legacy inline `todo.tags` field.
 */
export interface TextMatchContext {
  projectName?: string
  personNames?: string[]
  orgNames?: string[]
  statusName?: string
  tagNames?: string[]
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
  if (ctx?.projectName && ctx.projectName.toLowerCase().includes(q)) fields.push('project')
  if (ctx?.personNames && ctx.personNames.some(n => n.toLowerCase().includes(q))) fields.push('person')
  if (ctx?.orgNames && ctx.orgNames.some(n => n.toLowerCase().includes(q))) fields.push('org')
  if (ctx?.statusName && ctx.statusName.toLowerCase().includes(q)) fields.push('status')
  if (ctx?.tagNames && ctx.tagNames.some(n => n.toLowerCase().includes(q))) fields.push('tag')
  return { matched: fields.length > 0, fields }
}
