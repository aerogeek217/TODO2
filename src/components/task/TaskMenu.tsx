import { useMemo, type RefObject } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useToday } from '../../hooks/use-today'
import { MenuPopover } from '../workspace/MenuPopover'
import { buildTaskMenuEntries, type TaskMenuHandlers } from './task-menu-entries'

/**
 * The task menu as a popover: anchored to the row's ⋯ button, or at the
 * pointer for right-click / long-press. With `selectionAware` (rows) it acts
 * on the selection the task belongs to; search results act on the one task.
 */
export function TaskMenu({ todo, anchorRef, point, selectionAware = true, handlers, onClose }: {
  todo: PersistedTodoItem
  anchorRef?: RefObject<HTMLElement | null>
  point?: { x: number; y: number }
  selectionAware?: boolean
  handlers: TaskMenuHandlers
  onClose: () => void
}) {
  const selected = useUIStore((s) => s.selectedTodoIds)
  const todos = useTodoStore((s) => s.todos)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const today = useToday()
  const targets = useMemo(() => {
    if (!selectionAware || selected.size < 2 || !selected.has(todo.id)) return [todo]
    return todos.filter((t) => selected.has(t.id))
  }, [selectionAware, selected, todos, todo])
  const entries = buildTaskMenuEntries({ todo, targets, today, urgentRange, handlers })
  return (
    <MenuPopover
      anchorRef={anchorRef}
      point={point}
      // Under the ⋯ button, right edges aligned; at the pointer, from its corner.
      placement={anchorRef ? 'bottom-end' : 'bottom-start'}
      entries={entries}
      label={targets.length > 1 ? `${targets.length} tasks` : 'Task actions'}
      width={248}
      closeOnScroll
      onClose={onClose}
    />
  )
}
