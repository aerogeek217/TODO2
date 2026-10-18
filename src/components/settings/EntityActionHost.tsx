import { useUIStore } from '../../stores/ui-store'
import { PeopleEditor } from './PeopleEditor'
import { TagEditor } from './TagEditor'
import { DeletePersonConfirm, DeleteTagConfirm } from './EntityDeleteConfirm'

/**
 * A person's / tag's menu (a task row's avatar or tag, a people / tag
 * picker's option) acts through here (`ui-store.entityAction`): Edit… opens
 * the People or Tags editor on that one entry, Delete… its delete confirm
 * (the same ones Settings uses). Both sit on the top tier, over any dialog or
 * picker the menu opened from (which stays open behind them).
 */
export function EntityActionHost() {
  const action = useUIStore((s) => s.entityAction)
  const close = useUIStore((s) => s.closeEntityAction)
  if (!action) return null
  if (action.action === 'edit') {
    return action.kind === 'person'
      ? <PeopleEditor editPersonId={action.id} focusField="name" layer="nested" onClose={close} />
      : <TagEditor editTagId={action.id} layer="nested" onClose={close} />
  }
  return action.kind === 'person'
    ? <DeletePersonConfirm personId={action.id} onDone={close} />
    : <DeleteTagConfirm tagId={action.id} onDone={close} />
}
