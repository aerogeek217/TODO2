import { useEffect, useState } from 'react'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { ConfirmDialog } from '../shared/Dialog'
import { plural } from './sections/plural'

/**
 * "Delete person": names the person and how many tasks they're assigned to
 * (any task, loaded or not). Cancel has the focus; Confirm deletes (undoable
 * from the snackbar); either answer calls `onDone`. On the top tier, over the
 * editor, picker or dialog it was asked from. Nothing shows once the person
 * is gone.
 */
export function DeletePersonConfirm({ personId, onDone }: { personId: number; onDone: () => void }) {
  const person = usePersonStore((s) => s.people.find((p) => p.id === personId))
  const [count, setCount] = useState(0)
  useEffect(() => {
    let live = true
    void usePersonStore.getState().countTasks(personId).then((n) => { if (live) setCount(n) })
    return () => { live = false }
  }, [personId])
  if (!person) return null
  return (
    <ConfirmDialog
      open
      title="Delete person"
      message={
        <>
          Delete <strong>{person.name}</strong>?
          {count > 0 && ` Assigned to ${plural(count, 'task')}.`}
        </>
      }
      confirmLabel="Delete"
      danger
      nested
      initialFocus="cancel"
      onConfirm={() => { void usePersonStore.getState().remove(personId); onDone() }}
      onCancel={onDone}
    />
  )
}

/**
 * "Delete tag": names the tag and how many tasks carry it (any task, loaded
 * or not). Cancel has the focus; Confirm deletes (undoable from the
 * snackbar); either answer calls `onDone`. On the top tier, like the person
 * confirm. Nothing shows once the tag is gone.
 */
export function DeleteTagConfirm({ tagId, onDone }: { tagId: number; onDone: () => void }) {
  const tag = useTagStore((s) => s.tags.find((t) => t.id === tagId))
  const [count, setCount] = useState(0)
  useEffect(() => {
    let live = true
    void useTagStore.getState().countTasks(tagId).then((n) => { if (live) setCount(n) })
    return () => { live = false }
  }, [tagId])
  if (!tag) return null
  return (
    <ConfirmDialog
      open
      title="Delete tag"
      message={
        <>
          Delete <strong>{tag.name}</strong>?
          {count > 0 && ` ${plural(count, 'task')} currently tagged.`}
        </>
      }
      confirmLabel="Delete"
      danger
      nested
      initialFocus="cancel"
      onConfirm={() => { void useTagStore.getState().remove(tagId); onDone() }}
      onCancel={onDone}
    />
  )
}
