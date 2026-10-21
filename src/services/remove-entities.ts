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

/**
 * Removes the people and tags (Settings › Unused people & tags) with their
 * task assignments, in one transaction, behind the backup gate
 * (`takeSafetySnapshot` — a redo skips it, the first run backed this data
 * up), as one undo step with the snackbar (`Remove 3 people and 2 tags`):
 * Undo puts every row back with its id and assignments. Filters naming
 * them keep the ids (they stop matching), as a single delete leaves them.
 * A failed write changes nothing and says so in the snackbar. Resolves
 * whether they were removed; never rejects, except a redo's failure, which
 * the undo store reports.
 */
export async function removePeopleAndTags(personIds: readonly number[], tagIds: readonly number[]): Promise<boolean> {
  if (personIds.length === 0 && tagIds.length === 0) return false
  const what = peopleAndTags(personIds.length, tagIds.length)
  const replaying = useUndoStore.getState().isPerformingUndoRedo
  let noBackup = false
  if (!replaying) {
    const snapshot = await takeSafetySnapshot(`removing ${what}`)
    if (snapshot === 'cancelled') return false
    noBackup = snapshot === 'without-backup'
  }

  let removed: RemovedEntities
  try {
    removed = await trackWrite(async () => {
      const r = await deletePeopleAndTags(personIds, tagIds)
      usePersonStore.getState().forgetPeople(r.people.map((p) => p.id!))
      useTagStore.getState().forgetTags(r.tags.map((t) => t.id!))
      return r
    })
  } catch (e) {
    console.error(`Failed to remove ${what}:`, e)
    if (replaying) throw e
    useUndoStore.getState().notify(`Couldn’t remove ${what}. Nothing was changed.`)
    return false
  }

  // Ids already gone were skipped: the step names what was removed.
  if (removed.people.length === 0 && removed.tags.length === 0) return false
  const description = removeEntitiesDescription(removed.people.length, removed.tags.length)
  undoable(
    noBackup ? `${description} — no backup was taken` : description,
    async () => { await removePeopleAndTags(personIds, tagIds) },
    async () => {
      await trackWrite(() => restorePeopleAndTags(removed))
      await reloadPeopleAndTags()
    },
    true,
  )
  return true
}
