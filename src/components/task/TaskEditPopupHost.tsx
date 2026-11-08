import { useTaskEditCallbacks } from '../../hooks/use-task-edit-callbacks'
import { useUIStore } from '../../stores/ui-store'
import { useReviewStore } from '../../stores/review-store'
import { TaskEditPopup } from './TaskEditPopup'

/**
 * Hosts the task editor for a page: the edit popup for the task
 * `ui-store.openEditPopup` targets, and the create popup
 * (`ui-store.openCreatePopup`, e.g. QuickAdd's Details handoff).
 */
export function TaskEditPopupHost() {
  // Closed, the host renders for nothing but the editor opening.
  const open = useUIStore((s) => s.editPopupMode !== null)
  return open ? <OpenTaskEditor /> : null
}

function OpenTaskEditor() {
  const taskEdit = useTaskEditCallbacks()
  // Opened from the task dialog or the review deck: stacked over it, which stays in view.
  const overTaskDialog = useUIStore((s) => s.taskDialog !== null)
  const overReview = useReviewStore((s) => s.open)

  if (taskEdit.editPopupMode === 'edit' && taskEdit.editProps) {
    return (
      <TaskEditPopup
        mode="edit"
        {...taskEdit.editProps}
        allPeople={taskEdit.allPeople}
        allTags={taskEdit.allTags}
        onClose={taskEdit.closeEditPopup}
        {...taskEdit.entityCreators}
        nested={overTaskDialog || overReview}
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
