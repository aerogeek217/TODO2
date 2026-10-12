/**
 * Who the check-in dialog lists: everyone with at least one open task
 * assigned, plus the people it was opened for (even with none). The people
 * it was opened for come first, in the order given; the rest by name.
 */
import type { PersistedPerson, Person, PersistedTodoItem } from '../../models'

export function checkinRecipients(
  people: readonly Person[],
  todos: readonly PersistedTodoItem[],
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>,
  openedFor: readonly number[],
): PersistedPerson[] {
  const withOpenTasks = new Set<number>()
  for (const t of todos) {
    if (t.isCompleted) continue
    for (const p of assignedPeopleMap.get(t.id) ?? []) {
      if (p.id != null) withOpenTasks.add(p.id)
    }
  }
  const byId = new Map<number, PersistedPerson>()
  for (const p of people) {
    const id = p.id
    if (id != null) byId.set(id, { ...p, id })
  }
  const first = openedFor.flatMap((id) => {
    const p = byId.get(id)
    return p ? [p] : []
  })
  const firstIds = new Set(first.map((p) => p.id))
  const rest = [...byId.values()]
    .filter((p) => !firstIds.has(p.id) && withOpenTasks.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...first, ...rest]
}
