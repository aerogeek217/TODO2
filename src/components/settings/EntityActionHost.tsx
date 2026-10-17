import { useUIStore } from '../../stores/ui-store'
import { PeopleEditor } from './PeopleEditor'
import { TagEditor } from './TagEditor'
import { DeletePersonConfirm, DeleteTagConfirm } from './EntityDeleteConfirm'

/**
 * A task row's avatar / tag menu acts through here (`ui-store.entityAction`):
 * Edit… opens the People or Tags editor on that one entry, Delete… its
 * delete confirm (the same ones Settings uses).
 */
export function EntityActionHost() {
  const action = useUIStore((s) => s.entityAction)
  const close = useUIStore((s) => s.closeEntityAction)
  if (!action) return null
  if (action.action === 'edit') {
    return action.kind === 'person'
      ? <PeopleEditor editPersonId={action.id} focusField="name" onClose={close} />
      : <TagEditor editTagId={action.id} onClose={close} />
  }
  return action.kind === 'person'
    ? <DeletePersonConfirm personId={action.id} onDone={close} />
    : <DeleteTagConfirm tagId={action.id} onDone={close} />
}
