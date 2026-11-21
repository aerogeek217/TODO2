import { useContext, useMemo, type RefObject } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { copyTasks, inDisplayOrder } from '../../services/task-copy'
import { shortcutLabel } from '../../utils/shortcut-bindings'
import { useToday } from '../../hooks/use-today'
import { MenuPopover } from '../shared/MenuPopover'
import { buildTaskMenuEntries, type TaskMenuHandlers } from './task-menu-entries'
import { TaskMenuExtrasContext } from './task-menu-extras'
import { planForDayEntries } from './plan-menu'

/**
 * The task menu as a popover: at the pointer for right-click / long-press,
 * or under a row's focused cell for Shift+F10 / the context-menu key (the
 * cell gets the focus back). With `selectionAware` (rows) it acts on the
 * selection the task belongs to; search results act on the one task. Copy
 * copies them in the order their widget shows them, as one list with no
 * heading. For one task it offers Plan for day › (`plan-menu`), unless the
 * surface the row sits in has entries of its own for it
 * (`TaskMenuExtrasContext`: a Planner row's Plan for day ›, Snooze, Unplan).
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
  const followupIntervals = useSettingsStore((s) => s.followupQuickIntervals)
  const shortcutOverrides = useSettingsStore((s) => s.shortcutOverrides)
  const today = useToday()
  const extras = useContext(TaskMenuExtrasContext)
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
    followupIntervals,
    handlers: { onCopy, ...handlers },
    // The surface's own (a Planner row's), else Plan for day › against this week.
    extra: targets.length === 1 ? (extras ? extras(todo) : planForDayEntries(todo, today)) : undefined,
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
