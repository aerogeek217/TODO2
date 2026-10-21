import { useMemo, type RefObject } from 'react'
import type { MarkerKey, PersistedTodoItem } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useToday } from '../../hooks/use-today'
import { MARKERS_LABEL } from '../../utils/markers'
import { MenuPopover } from '../shared/MenuPopover'
import { markerMenuEntries } from './task-menu-entries'

/**
 * The row's markers menu, opened from its marker gutter: the task menu's
 * marker checkboxes on their own, acting on the selection the task belongs
 * to (each flips its flag; a due date that makes the task urgent is a hint).
 */
export function PriorityMenu({ todo, anchorRef, onSetMarker, onClose }: {
  todo: PersistedTodoItem
  anchorRef: RefObject<HTMLElement | null>
  onSetMarker: (marker: MarkerKey, on: boolean) => void
  onClose: () => void
}) {
  const selected = useUIStore((s) => s.selectedTodoIds)
  const todos = useTodoStore((s) => s.todos)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const today = useToday()
  const targets = useMemo(() => {
    if (selected.size < 2 || !selected.has(todo.id)) return [todo]
    return todos.filter((t) => selected.has(t.id))
  }, [selected, todos, todo])
  const entries = markerMenuEntries(targets, today, urgentRange, onSetMarker)
  return (
    <MenuPopover
      anchorRef={anchorRef}
      placement="bottom-start"
      entries={entries}
      label={targets.length > 1 ? `${MARKERS_LABEL} · ${targets.length} tasks` : MARKERS_LABEL}
      width={200}
      closeOnScroll
      onClose={onClose}
    />
  )
}
