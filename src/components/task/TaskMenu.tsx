import { useMemo, type RefObject } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { copyTasks, inDisplayOrder } from '../../services/task-copy'
import { shortcutLabel } from '../../utils/shortcut-bindings'
import { useToday } from '../../hooks/use-today'
import { MenuPopover } from '../shared/MenuPopover'
import { buildTaskMenuEntries, type TaskMenuHandlers } from './task-menu-entries'

/**
 * The task menu as a popover: at the pointer for right-click / long-press,
 * or under a row's focused cell for Shift+F10 / the context-menu key (the
 * cell gets the focus back). With `selectionAware` (rows) it acts on the
 * selection the task belongs to; search results act on the one task. Copy
 * copies them in the order their widget shows them, as one list with no
 * heading.
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
  const shortcutOverrides = useSettingsStore((s) => s.shortcutOverrides)
  const today = useToday()
  const targets = useMemo(() => {
    if (!selectionAware || selected.size < 2 || !selected.has(todo.id)) return [todo]
    return todos.filter((t) => selected.has(t.id))
  }, [selectionAware, selected, todos, todo])
  const onCopy = () => {
    const scope = targets.length > 1 ? useUIStore.getState().selectionScope : null
    void copyTasks([{ todos: inDisplayOrder(targets, scope) }])
  }
  const entries = buildTaskMenuEntries({
    todo,
    targets,
    today,
    urgentRange,
    handlers: { onCopy, ...handlers },
    copyKbd: shortcutLabel('copy-selected', shortcutOverrides),
  })
  return (
    <MenuPopover
      anchorRef={anchorRef}
      point={point}
      placement="bottom-start"
      entries={entries}
      label={targets.length > 1 ? `${targets.length} tasks` : 'Task actions'}
      width={248}
      closeOnScroll
      onClose={onClose}
    />
  )
}
