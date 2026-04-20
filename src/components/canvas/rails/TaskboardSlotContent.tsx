import { TaskboardPanel } from '../../taskboard/TaskboardPanel'

/**
 * Rail slot body for the taskboard. The TaskboardPanel is already a reusable
 * body (also used on the dashboard) — the rail slot just inserts it, passing
 * through the `taskboardId` the slot references so multiple rail/float/
 * dashboard surfaces can render different taskboards independently.
 */
export function TaskboardSlotContent({ taskboardId }: { taskboardId?: number }) {
  return <TaskboardPanel taskboardId={taskboardId} hideHeader />
}
