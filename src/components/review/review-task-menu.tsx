import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { PersistedTodoItem } from '../../models'
import { useUIStore } from '../../stores/ui-store'
import { oneTaskMenuHandlers } from '../task/one-task-menu'
import { TaskMenu } from '../task/TaskMenu'

const openInEditor = (id: number) => useUIStore.getState().openEditPopup(id)

/** A right-click in a text field keeps the browser's own menu (cut, copy, paste). */
function inTextField(target: EventTarget): boolean {
  return target instanceof Element && target.closest('input:not([type="checkbox"]), textarea, [contenteditable="true"]') != null
}

/**
 * The task menu for a task in a review — a rail row, the card's title row: a
 * right-click (Shift+F10 / the Menu key) opens it for that one task
 * (`oneTaskMenuHandlers`, as a calendar entry's: never the selection, no row
 * pickers), at the pointer, or under the element from the keyboard. Open
 * opens the task in its editor (or `onOpen`). A right-click in a text field
 * keeps the browser's menu. `menu(todo)` draws it while open for that task;
 * a task that went (deleted, left the queue) draws nothing.
 */
export function useReviewTaskMenu(onOpen: (id: number) => void = openInEditor) {
  const [open, setOpen] = useState<{ id: number; point?: { x: number; y: number } } | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const onContextMenu = (id: number, before?: () => void) => (e: ReactMouseEvent<HTMLElement>) => {
    if (inTextField(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    before?.()
    anchorRef.current = e.currentTarget
    // From the keyboard (no right button): under the element.
    setOpen({ id, point: e.button === 2 ? { x: e.clientX, y: e.clientY } : undefined })
  }
  const menu = (todo: PersistedTodoItem | undefined): ReactNode => {
    if (!open || !todo || todo.id !== open.id) return null
    return (
      <TaskMenu
        todo={todo}
        anchorRef={open.point ? undefined : anchorRef}
        point={open.point}
        selectionAware={false}
        handlers={oneTaskMenuHandlers({ todo, onOpen })}
        onClose={() => setOpen(null)}
      />
    )
  }
  return { onContextMenu, menuId: open?.id ?? null, menu }
}
