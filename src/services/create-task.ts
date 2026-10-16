import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'
import { markerFlags, seedsMarkers, supplementWithFilterDefaults, type FilterDefaults } from '../utils/filter-defaults'
import type { ResolvedInput } from './nlp-resolver'
import { applyNlpMetadata } from './nlp-task-creator'

/**
 * Quick Add's submit: the task from the bar's parsed text, with the defaults
 * of where it was added (`defaults` — a list's predicate seed, else the
 * screen filter) filling what the text didn't say. Returns the new task's id.
 */
export async function createQuickAddTask(
  submitted: { title: string; resolved: ResolvedInput },
  fd: FilterDefaults,
): Promise<number> {
  const { resolved } = submitted
  // `supplementWithFilterDefaults` only fills fields the user didn't type —
  // so an `@person` token always wins over the seed. (A list widget's seed
  // already carries its prompt picks.)
  supplementWithFilterDefaults(resolved, fd)
  // Parse-cleaned title fed to addTodo, then applyNlpMetadata for everything
  // the resolver pulled out. Tags ride through applyNlpMetadata's
  // resolve-or-create path (`nlp-task-creator.ts`).
  const id = await useTodoStore.getState().add(resolved.title || submitted.title)
  await applyNlpMetadata(
    id,
    resolved,
    (tid) => useTodoStore.getState().todos.find((t) => t.id === tid),
    useTodoStore.getState().update,
    usePersonStore.getState().assignPerson,
  )
  // Seed-default tags ride a separate channel (resolved.tags is slug-based,
  // applyNlpMetadata calls resolveTags on it). Tag ids from a list-predicate
  // seed / active filter are already resolved against the registry so we
  // assign them directly. User-typed `#tag` tokens still take precedence —
  // applyNlpMetadata applied those above; this only adds the seed ids that
  // weren't already covered.
  if (fd.tagIds.length > 0) {
    const tagStore = useTagStore.getState()
    for (const tagId of fd.tagIds) {
      await tagStore.assignTag(id, tagId)
    }
  }
  // A Markers filter (e.g. the Focus list's "+ Add task"): the task starts
  // with those markers so it shows where it was added.
  if (seedsMarkers(fd)) await useTodoStore.getState().update(id, markerFlags(fd))
  return id
}
