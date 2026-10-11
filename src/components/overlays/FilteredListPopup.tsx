import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore, type AttributeFilter } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { TaskRow } from '../task/TaskRow'
import { bySortOrder } from '../../utils/sort-order'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './FilteredListPopup.module.css'

function getHeaderInfo(filter: AttributeFilter): { label: string; icon: React.ReactNode } {
  switch (filter.type) {
    case 'person':
      return { label: filter.personName, icon: <span>@</span> }
  }
}

/**
 * Point-anchored popover listing the open tasks of one attribute (today: a
 * person) — opened from a person chip / avatar.
 */
export function FilteredListPopup() {
  const popup = useUIStore((s) => s.filteredListPopup)
  const hideFilteredList = useUIStore((s) => s.hideFilteredList)

  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const filteredTodos = useMemo(() => {
    if (!popup) return []
    const { filter } = popup
    return todos.filter(todo => {
      if (todo.isCompleted) return false
      switch (filter.type) {
        case 'person': {
          const assigned = assignedPeopleMap.get(todo.id)
          return assigned?.some(p => p.id === filter.personId) ?? false
        }
      }
    }).sort(bySortOrder)
  }, [popup, todos, assignedPeopleMap])

  // Scroll/resize don't close; Escape and outside-click close.
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x: popup?.x ?? 0, y: popup?.y ?? 0 },
    open: popup != null,
    closeOnScroll: false,
    closeOnResize: false,
    onClose: hideFilteredList,
  })

  if (!popup) return null

  const { label, icon } = getHeaderInfo(popup.filter)

  return createPortal(
    <>
      <div
        className={styles.backdrop}
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
      />
      <div
        ref={panelRef}
        className={styles.popup}
        style={{ ...style, zIndex: 9999 }}
      >
        <div className={styles.header}>
          <span className={styles.headerIcon}>{icon}</span>
          <span className={styles.headerLabel}>{label}</span>
          <span className={styles.headerCount}>{filteredTodos.length}</span>
          <button className={styles.closeButton} onClick={hideFilteredList}>&times;</button>
        </div>
        <div className={styles.body}>
          {filteredTodos.length === 0 ? (
            <div className={styles.emptyMessage}>No tasks</div>
          ) : (
            filteredTodos.map(todo => (
              <TaskRow
                key={todo.id}
                todo={todo}
                assignedPeople={assignedPeopleMap.get(todo.id)}
                onOpenDetail={() => { hideFilteredList(); openEditPopup(todo.id) }}
              />
            ))
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
