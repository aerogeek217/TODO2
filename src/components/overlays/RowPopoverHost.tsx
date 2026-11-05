import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore, type RowPopoverRequest } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { PopoverLevelContext } from '../shared/popover-level'
import { TaskNotePopover } from '../task/TaskNotePopover'
import { SubtasksPopover } from '../task/subtasks/SubtasksPopover'
import { SubtasksSheet } from '../task/subtasks/SubtasksSheet'

/**
 * Shows the notes popover or the checklist (popover, or the phone's sheet) a
 * task row asks for (`ui-store.rowPopover`, `useTaskRowPickers`). Hosted
 * here, not in the row, for the reason `FollowupPopoverHost` gives: what is
 * written in it — a status update that marks the task followed up, a
 * checked subtask or typed notes that move its Modified date — can take the
 * row out of its list or group, and it stays open (cr31 T1). It follows the
 * row's trigger while the row is there and stays where it was once the row
 * is gone. A layout switch closes it, its task being off the screen; so does
 * the task being deleted.
 */
export function RowPopoverHost() {
  const request = useUIStore((s) => s.rowPopover)
  if (!request) return null
  return <OpenRowPopover key={`${request.kind}:${request.todoId}`} request={request} />
}

function OpenRowPopover({ request }: { request: RowPopoverRequest }) {
  const { todoId } = request
  const close = useUIStore((s) => s.closeRowPopover)
  const todo = useTodoStore((s) => s.todos.find((t) => t.id === todoId))

  useEffect(() => { if (!todo) close() }, [todo, close])

  const layoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const openedOnLayout = useRef(layoutId)
  useEffect(() => { if (layoutId !== openedOnLayout.current) close() }, [layoutId, close])

  if (!todo) return null
  return (
    // `PopoverRoot` adds one: the level the row's place gives it (2 in a dialog).
    <PopoverLevelContext.Provider value={request.level - 1}>
      {request.kind === 'notes' ? createPortal(
        <TaskNotePopover todoId={todoId} anchorRef={request.anchorRef} onClose={close} />,
        document.body,
      ) : request.sheet ? (
        <SubtasksSheet todo={todo} onClose={close} focusAdd={request.focusAdd} />
      ) : createPortal(
        <SubtasksPopover
          todo={todo}
          anchorRef={request.anchorRef}
          anchorIsInside={request.anchorIsInside}
          onClose={close}
          onOpenDetail={request.onOpenDetail}
          focusAdd={request.focusAdd}
        />,
        document.body,
      )}
    </PopoverLevelContext.Provider>
  )
}
