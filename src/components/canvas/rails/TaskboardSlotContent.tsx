import { TaskboardPanel } from '../../taskboard/TaskboardPanel'

/**
 * Rail slot body for the taskboard. The TaskboardPanel is already a reusable
 * body (also used on the dashboard) — the rail slot just inserts it. The
 * panel renders its own droppable/sortable context; the surrounding rail
 * header supplies the slot chrome (drag handle, ⇱ pop-out, ⋯ menu, × close).
 */
export function TaskboardSlotContent() {
  return <TaskboardPanel />
}
