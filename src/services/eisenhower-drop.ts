import { usePersonStore } from '../stores/person-store'
import { currentFilterSettings } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import { dropDescription, type PaneChange, type PaneContext } from '../utils/eisenhower'

/**
 * Eisenhower pane drops against the stores: what the pane filters are
 * evaluated with at the drop, and the drop's writes as one undo step.
 */

/** The pane context as the stores have it now (`today` = midnight of the drop's day). */
export function currentPaneContext(today: Date): PaneContext {
  const { people, assignedPeopleMap } = usePersonStore.getState()
  const { tags, assignedTagsMap } = useTagStore.getState()
  return {
    today,
    settings: currentFilterSettings(),
    assignedPeopleMap,
    assignedTagsMap,
    people,
    tags,
    statuses: useStatusStore.getState().statuses,
  }
}

/** `ids` of the changes that set `key`, grouped by the value they set. */
function idsByValue(changes: readonly PaneChange[], key: 'statusId' | 'personId' | 'tagId'): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const c of changes) {
    const v = c[key]
    if (v === undefined) continue
    out.set(v, [...(out.get(v) ?? []), c.todoId])
  }
  return out
}

/**
 * Writes a pane drop's changes (`resolvePaneDrop`) as one undo step with
 * the undo snackbar (`dropDescription`): the flags, then the status, then
 * the person / tag added.
 */
export async function applyPaneDrop(changes: readonly PaneChange[]): Promise<void> {
  if (changes.length === 0) return
  const todos = useTodoStore.getState().todos
  const description = dropDescription(changes, (id) => todos.find((t) => t.id === id)?.title, {
    people: usePersonStore.getState().people,
    tags: useTagStore.getState().tags,
    statuses: useStatusStore.getState().statuses,
  })
  const flags = changes.filter((c) => c.urgent !== undefined || c.important !== undefined || c.focus !== undefined)
  const statuses = idsByValue(changes, 'statusId')
  const people = idsByValue(changes, 'personId')
  const tags = idsByValue(changes, 'tagId')
  // Flags alone (the default panes): the flag write is the undo step itself.
  if (statuses.size === 0 && people.size === 0 && tags.size === 0) {
    await useTodoStore.getState().setMarkerFlags(flags, description)
    return
  }
  const undo = useUndoStore.getState()
  undo.beginGroup()
  try {
    if (flags.length > 0) await useTodoStore.getState().setMarkerFlags(flags, description)
    for (const [statusId, ids] of statuses) await useTodoStore.getState().bulkSetStatus(ids, statusId)
    for (const [personId, ids] of people) await usePersonStore.getState().bulkAssignPerson(ids, personId)
    for (const [tagId, ids] of tags) await useTagStore.getState().bulkAssignTag(ids, tagId)
  } finally {
    useUndoStore.getState().endGroup(description, true)
  }
}
