import { deletePeopleAndTags, restorePeopleAndTags, type RemovedEntities } from '../data/entity-removal'
import { usePersonStore } from '../stores/person-store'
import { takeSafetySnapshot } from '../stores/safety-snapshot'
import { trackWrite } from '../stores/store-helpers'
import { useTagStore } from '../stores/tag-store'
import { undoable } from '../stores/undoable'
import { useUndoStore } from '../stores/undo-store'
import { peopleAndTags, removeEntitiesDescription } from '../utils/unused-entities'

/** Re-reads the people and tags, and the assignments of the tasks their maps hold (restored joins are only in the database). */
async function reloadPeopleAndTags(): Promise<void> {
  await Promise.all([usePersonStore.getState().load(), useTagStore.getState().load()])
  await Promise.all([
    usePersonStore.getState().loadAssignments([...usePersonStore.getState().assignedPeopleMap.keys()], { refetch: true }),
    useTagStore.getState().loadAssignments([...useTagStore.getState().assignedTagsMap.keys()], { refetch: true }),
  ])
}

/** Deletes them with their assignments as a tracked write and drops them from the stores; returns the rows as they were. */
function deleteAndForget(personIds: readonly number[], tagIds: readonly number[]): Promise<RemovedEntities> {
  return trackWrite(async () => {
    const r = await deletePeopleAndTags(personIds, tagIds)
    usePersonStore.getState().forgetPeople(r.people.map((p) => p.id!))
    useTagStore.getState().forgetTags(r.tags.map((t) => t.id!))
    return r
  })
}

/**
 * Removes the people and tags (Settings › Unused people & tags) with their
 * task assignments, in one transaction, behind the backup gate
 * (`takeSafetySnapshot`), as one undo step with the snackbar (`Remove 3
 * people and 2 tags`): Undo puts every row back with its id and the
 * assignments it had when last removed — a Redo removes them again (no
 * second backup: the first run backed this data up) and captures afresh,
 * so assignments made between Undo and Redo come back with the next Undo.
 * Filters naming them keep the ids (they stop matching), as a single
 * delete leaves them. A failed write changes nothing and says so in the
 * snackbar. Resolves whether they were removed; never rejects (a failed
 * redo throws to the undo store, which reports it).
 */
export async function removePeopleAndTags(personIds: readonly number[], tagIds: readonly number[]): Promise<boolean> {
  if (personIds.length === 0 && tagIds.length === 0) return false
  const what = peopleAndTags(personIds.length, tagIds.length)
  const snapshot = await takeSafetySnapshot(`removing ${what}`)
  if (snapshot === 'cancelled') return false

  let removed: RemovedEntities
  try {
    removed = await deleteAndForget(personIds, tagIds)
  } catch (e) {
    console.error(`Failed to remove ${what}:`, e)
    useUndoStore.getState().notify(`Couldn’t remove ${what}. Nothing was changed.`)
    return false
  }

  // Ids already gone were skipped: the step names what was removed.
  if (removed.people.length === 0 && removed.tags.length === 0) return false
  const description = removeEntitiesDescription(removed.people.length, removed.tags.length)
  undoable(
    snapshot === 'without-backup' ? `${description} — no backup was taken` : description,
    async () => { removed = await deleteAndForget(personIds, tagIds) },
    async () => {
      await trackWrite(() => restorePeopleAndTags(removed))
      await reloadPeopleAndTags()
    },
    true,
  )
  return true
}
