import { TaskboardPanel } from '../../taskboard/TaskboardPanel'

/**
 * Rail slot body for the taskboard. The TaskboardPanel is already a reusable
 * body (also used on the dashboard) — the rail slot just inserts it. The
 * taskboard is a singleton, so every surface renders the same board.
 */
export function TaskboardSlotContent() {
  return <TaskboardPanel hideHeader />
}
