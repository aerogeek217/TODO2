import { createContext, useContext } from 'react'
import { taskRowColumns, type TaskRowColumns } from '../../utils/task-row-columns'

/** The width rows are laid out for outside a `TaskRowGrid` (the drag overlay's copy, a row on its own). */
export const UNMEASURED_LIST_WIDTH = 528

const DEFAULT_COLUMNS = taskRowColumns(UNMEASURED_LIST_WIDTH)

/** The columns of the row list a `TaskRow` sits in (`TaskRowGrid`); the default split outside one. */
export const TaskRowColumnsContext = createContext<TaskRowColumns>(DEFAULT_COLUMNS)

export function useTaskRowColumns(): TaskRowColumns {
  return useContext(TaskRowColumnsContext)
}
