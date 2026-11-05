import { useEffect, useMemo, useRef } from 'react'
import { useBulkActions } from '../../hooks/use-bulk-actions'
import { newestStatusUpdate, useStatusUpdateStore } from '../../stores/status-update-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore, type FollowupPopoverRequest } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { FollowupPopover } from '../shared/followup/FollowupPopover'
import { PopoverLevelContext } from '../shared/popover-level'
import { sharedNextFollowup } from '../../utils/followup'

/**
 * Shows the follow-up popover a task row asks for (`ui-store.followupPopover`,
 * `useTaskRowPickers`). Hosted here, not in the row: the popover stays open
 * across a follow-up write, and that write can take the row out of its list
 * or group — it stays where it opened until Esc, an outside click or ⏎ on an
 * unchanged field. A layout switch closes it, its task being off the screen;
 * so does the task being deleted.
 */
export function FollowupPopoverHost() {
  const request = useUIStore((s) => s.followupPopover)
  if (!request) return null
  return <OpenFollowupPopover key={request.todoId} request={request} />
}

function OpenFollowupPopover({ request }: { request: FollowupPopoverRequest }) {
  const { todoId } = request
  const close = useUIStore((s) => s.closeFollowupPopover)
  const todo = useTodoStore((s) => s.todos.find((t) => t.id === todoId))
  // A row in a multi-selection edits the selection (`useBulkActions`): the
  // popover starts from what the selected tasks share, or mixed — as the bulk
  // bar's does —, so a date equal to this task's is still set on the others
  // (cr31 T11).
  const selectedIds = useUIStore((s) => s.selectedTodoIds)
  const todos = useTodoStore((s) => s.todos)
  const current = useMemo(() => {
    if (selectedIds.size <= 1 || !selectedIds.has(todoId)) return undefined
    return sharedNextFollowup(todos.filter((t) => selectedIds.has(t.id)))
  }, [selectedIds, todos, todoId])
  const newestUpdate = useStatusUpdateStore((s) => newestStatusUpdate(todoId, s.byTodo))
  const bulk = useBulkActions()

  useEffect(() => { if (!todo) close() }, [todo, close])

  const layoutId = useWorkspaceStore((s) => s.activeLayoutId)
  const openedOnLayout = useRef(layoutId)
  useEffect(() => { if (layoutId !== openedOnLayout.current) close() }, [layoutId, close])

  if (!todo) return null
  return (
    // `PopoverRoot` adds one: the level the row's place gives it (2 in a dialog).
    <PopoverLevelContext.Provider value={request.level - 1}>
      <FollowupPopover
        todo={todo}
        anchor={{ kind: 'rect', ...request.anchor }}
        triggerRef={request.triggerRef}
        onClose={close}
        onSetNext={(d) => bulk.setFollowup(todoId, d)}
        onFollowedUp={(next, update) => bulk.markFollowedUp(todoId, next, update)}
        newestUpdate={newestUpdate}
        current={current}
        initialFocus={request.initialFocus}
      />
    </PopoverLevelContext.Provider>
  )
}
