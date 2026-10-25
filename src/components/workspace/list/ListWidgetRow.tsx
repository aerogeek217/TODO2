import { memo, useCallback } from 'react'
import type { PersistedTodoItem, Person } from '../../../models'
import { TaskRow } from '../../task/TaskRow'
import { TaskDraggable } from '../../task/dnd/TaskDraggable'
import { taskDragId } from '../../../utils/task-dnd'
import styles from './ListWidget.module.css'
import type { LeavingPhase } from '../../../hooks/use-leaving-rows'
import { ROW_KEY_ATTR, ROW_TODO_ATTR } from '../../../utils/dom-contract'

/** Drag data of a list widget row (merged into the task drag payload). */
export interface ListRowDragData {
  listTabId: string
  sectionKey: string
  rowKey: string
}

/** A row's look while a row of its widget is dragged. */
export type ListRowDragLook =
  /** No drag, or not affected. */
  | 'idle'
  /** The dragged row, shown as the slot it will land in (manual order). */
  | 'slot'
  /** The dragged row, collapsed (its slot shows elsewhere). */
  | 'gone'
  /** The dragged row left in place, faded (sorted list / another group). */
  | 'origin'
  /** Another row of the list while rows make room (manual order). */
  | 'dim'

export interface ListRowSelectMods {
  shift: boolean
  ctrl: boolean
}

interface ListWidgetRowProps {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  /** The widget's tab id (selection scope, drag id). */
  tabId: string
  sectionKey: string
  rowKey: string
  selected: boolean
  /** Selected, and the row above / below isn't: rounds that corner. */
  selFirst: boolean
  selLast: boolean
  /** The keyboard cursor sits on this row. */
  cursor: boolean
  look: ListRowDragLook
  /** Just completed in a list that hides completed tasks: it lingers, then folds away (D19). */
  leaving?: LeavingPhase
  onSelect: (rowKey: string, todoId: number, mods: ListRowSelectMods) => void
  onOpenDetail: (todoId: number) => void
}

/**
 * One occurrence of a task in a list widget: draggable (one drag id per
 * occurrence), selectable, addressed by `rowKey` (`data-row-key`) for the
 * widget's selection and keyboard cursor.
 */
export const ListWidgetRow = memo(function ListWidgetRow({
  todo, assignedPeople, tabId, sectionKey, rowKey,
  selected, selFirst, selLast, cursor, look, leaving, onSelect, onOpenDetail,
}: ListWidgetRowProps) {
  const handleSelect = useCallback(
    (todoId: number, mods: ListRowSelectMods) => onSelect(rowKey, todoId, mods),
    [onSelect, rowKey],
  )
  const dragData: ListRowDragData = { listTabId: tabId, sectionKey, rowKey }
  const cls = [
    styles.row,
    selected ? styles.rowSelected : '',
    selected && selFirst ? styles.rowSelFirst : '',
    selected && selLast ? styles.rowSelLast : '',
    cursor ? styles.rowCursor : '',
    look === 'gone' ? styles.rowGone : '',
    look === 'origin' || look === 'dim' ? styles.rowFaded : '',
    leaving === 'fold' ? styles.rowFolding : '',
  ].filter(Boolean).join(' ')

  return (
    <TaskDraggable todo={todo} surface="list-widget" scope={tabId} sectionKey={sectionKey} extraData={{ ...dragData }}>
      {({ attributes, listeners, setNodeRef }) => (
        <div
          ref={setNodeRef}
          className={cls}
          {...{ [ROW_KEY_ATTR]: rowKey, [ROW_TODO_ATTR]: todo.id }}
          data-drag-id={taskDragId('list-widget', todo.id, { scope: tabId, sectionKey })}
          data-selected={selected ? 'true' : undefined}
          data-cursor={cursor ? 'true' : undefined}
          data-leaving={leaving}
          {...attributes}
          {...listeners}
          // Shift / Ctrl-click selects rows; don't let it select text too.
          onMouseDown={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault() }}
        >
          {look === 'slot' ? (
            <div className={styles.dropSlot} data-drop-slot="" />
          ) : (
            <TaskRow
              todo={todo}
              assignedPeople={assignedPeople}
              isSelected={selected}
              onSelect={handleSelect}
              onOpenDetail={onOpenDetail}
            />
          )}
        </div>
      )}
    </TaskDraggable>
  )
})
