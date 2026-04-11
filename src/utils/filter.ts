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
