import { useTaskEditCallbacks } from '../../hooks/use-task-edit-callbacks'
import { TaskEditPopup } from './TaskEditPopup'

/**
 * Hosts the task editor for a page: the edit popup for the task
 * `ui-store.openEditPopup` targets, and the create popup
 * (`ui-store.openCreatePopup`, e.g. QuickAdd's Details handoff).
 */
export function TaskEditPopupHost() {
  const taskEdit = useTaskEditCallbacks()

  if (taskEdit.editPopupMode === 'edit' && taskEdit.editProps) {
    return (
      <TaskEditPopup
        mode="edit"
        {...taskEdit.editProps}
        allPeople={taskEdit.allPeople}
        allTags={taskEdit.allTags}
        onClose={taskEdit.closeEditPopup}
        {...taskEdit.entityCreators}
      />
    )
  }

  if (taskEdit.editPopupMode === 'create') {
    return (
      <TaskEditPopup
        mode="create"
        assignedPeople={[]}
        allPeople={taskEdit.allPeople}
        onClose={taskEdit.closeEditPopup}
        onCreate={taskEdit.onCreate}
        assignedTags={[]}
        allTags={taskEdit.allTags}
        onAssignPerson={() => {}}
        onUnassignPerson={() => {}}
        onAssignTag={() => {}}
        onUnassignTag={() => {}}
        {...taskEdit.entityCreators}
      />
    )
  }

  return null
}
