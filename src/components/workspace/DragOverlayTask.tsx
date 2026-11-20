import type { ReactNode } from 'react'
import type { PersistedTodoItem } from '../../models'
import { TaskRow } from '../task/TaskRow'
import { LIFTED_TASK_ATTR } from './task-drop-animation'
import styles from './DragOverlayTask.module.css'

/**
 * A dragged task row, lifted (D25 E4): grows on grab (`DragOverlayTask.module.css`), settles on drop (`createTaskDropAnimation`).
 * `label` travels with it, under the row (what a drop on the target under it would do: the Planner's `PlannerDragLabel`).
 */
export function DragOverlayTask({ todo, label }: { todo: PersistedTodoItem; label?: ReactNode }) {
  return (
    <div className={styles.overlay} {...{ [LIFTED_TASK_ATTR]: 'task' }}>
      <TaskRow todo={todo} ghost />
      {label}
    </div>
  )
}
