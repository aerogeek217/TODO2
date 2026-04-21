import type { PersistedTodoItem } from '../models'

/**
 * For each todo in `todos`, return its "family" min date — i.e. the earliest
 * non-null date among the todo's root ancestor and all descendants of that root
 * that are present in the set.
 *
 * Used to keep parent/child families intact when sorting or bucketing by date.
 * A family member with no own date still gets its family's min date, so every
 * member groups into the same bucket / sorts to the same position.
 *
 * Todos whose parent isn't in the set are treated as their own root.
 */
export function buildFamilyDateMap(
  todos: PersistedTodoItem[],
  pickDate: (t: PersistedTodoItem) => Date | null,
): Map<number, Date | null> {
  const byId = new Map<number, PersistedTodoItem>()
  for (const t of todos) byId.set(t.id, t)

  const rootOf = new Map<number, number>()
  for (const t of todos) {
    let cur = t
    for (let d = 0; d < 10; d++) {
      if (cur.parentId == null || !byId.has(cur.parentId)) break
      cur = byId.get(cur.parentId)!
    }
    rootOf.set(t.id, cur.id)
  }

  const familyMin = new Map<number, Date | null>()
  for (const t of todos) {
    const rootId = rootOf.get(t.id)!
    const d = pickDate(t)
    if (d == null) continue
    const cur = familyMin.get(rootId)
    if (cur == null || d < cur) familyMin.set(rootId, d)
  }

  const result = new Map<number, Date | null>()
  for (const t of todos) {
    const rootId = rootOf.get(t.id)!
    result.set(t.id, familyMin.get(rootId) ?? null)
  }
  return result
}
