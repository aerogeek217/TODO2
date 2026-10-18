import type { TodoItem } from '../models'

/** Never part of a task edit: the row's id, and the edit stamp the write sets itself. */
const NOT_COMPARED = new Set<string>(['id', 'modifiedAt'])

/**
 * Whether two task field values are the same: Dates by time, plain objects
 * and arrays (e.g. a recurrence rule) by value. `undefined` and a missing
 * key are the same.
 */
export function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const key of keys) {
    if (!sameFieldValue(ra[key], rb[key])) return false
  }
  return true
}

/**
 * The fields of `next` that differ from `prev`, as a patch. A field `next`
 * lacks (or holds `undefined`) that `prev` has comes out as `undefined`,
 * which a Dexie `update` removes. `id` and `modifiedAt` are left out.
 */
export function todoChanges(prev: Partial<TodoItem>, next: Partial<TodoItem>): Partial<TodoItem> {
  const before = prev as Record<string, unknown>
  const after = next as Record<string, unknown>
  const changes: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (NOT_COMPARED.has(key)) continue
    if (!sameFieldValue(before[key], after[key])) changes[key] = after[key]
  }
  return changes as Partial<TodoItem>
}

/**
 * Undoes `changes` on `row` field by field: a field still holding the value
 * `changes` gave it goes back to its value in `before`; a field another
 * write changed since keeps that value.
 */
export function revertChanges(
  row: Partial<TodoItem>,
  changes: Partial<TodoItem>,
  before: Partial<TodoItem>,
): Partial<TodoItem> {
  const current = row as Record<string, unknown>
  const ours = changes as Record<string, unknown>
  const prior = before as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(changes)) {
    if (sameFieldValue(current[key], ours[key])) out[key] = prior[key]
  }
  return out as Partial<TodoItem>
}

/** `row`'s values for the fields `changes` names (what undoing `changes` writes back). */
export function fieldsOf(row: Partial<TodoItem>, changes: Partial<TodoItem>): Partial<TodoItem> {
  const source = row as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(changes)) out[key] = source[key]
  return out as Partial<TodoItem>
}
