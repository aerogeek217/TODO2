import type { CrossGroupMutation } from '../utils/cross-group-drag'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'

/**
 * Apply the field-mutation implied by a cross-group drag (derived by
 * `utils/cross-group-drag.resolveCrossGroupMutation`). Stateless: reads each
 * store's imperative `getState()` API directly so it can be called from
 * anywhere (including outside React) without threading store deps through
 * the caller.
 */
export async function dispatchCrossGroupMutation(mutation: CrossGroupMutation): Promise<void> {
  switch (mutation.kind) {
    case 'status': {
      await useTodoStore.getState().bulkSetStatus([mutation.todoId], mutation.statusId)
      return
    }
    case 'people': {
      if (mutation.removeId != null) {
        await usePersonStore.getState().unassignPerson(mutation.todoId, mutation.removeId)
      }
      if (mutation.addId != null) {
        await usePersonStore.getState().assignPerson(mutation.todoId, mutation.addId)
      }
      return
    }
    case 'tag': {
      if (mutation.removeId != null) {
        await useTagStore.getState().unassignTag(mutation.todoId, mutation.removeId)
      }
      if (mutation.addId != null) {
        await useTagStore.getState().assignTag(mutation.todoId, mutation.addId)
      }
      return
    }
  }
}
