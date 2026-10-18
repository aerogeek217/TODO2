import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type RefObject } from 'react'
import { taskRowColumns, type TaskRowColumns } from '../../utils/task-row-columns'
import { createValueStore, type ValueStore } from '../../utils/value-store'

/** The width rows are laid out for outside a `TaskRowGrid` (the drag overlay's copy, a row on its own). */
export const UNMEASURED_LIST_WIDTH = 528

const DEFAULT_COLUMNS = taskRowColumns(UNMEASURED_LIST_WIDTH)

/**
 * The columns of the row list a `TaskRow` sits in (`TaskRowGrid`), as a
 * store: they change on every frame of a divider drag, and a row re-renders
 * only when a part it shows changes (`useTaskRowColumn`); its tracks are
 * written to its style straight from the store (`useTaskRowTracks`). The
 * default split outside a grid.
 */
export const TaskRowColumnsContext = createContext<ValueStore<TaskRowColumns>>(createValueStore(DEFAULT_COLUMNS))

/**
 * One reading of the row list's columns, e.g. whether the tags column is
 * there or how many avatars fit. `select` must return a primitive (or the
 * same object) for unchanged columns: the caller re-renders when it changes.
 */
export function useTaskRowColumn<T>(select: (columns: TaskRowColumns) => T): T {
  const store = useContext(TaskRowColumnsContext)
  return useSyncExternalStore(store.subscribe, () => select(store.get()))
}

/**
 * Keeps the row element's `grid-template-columns` on its list's tracks,
 * written to the element straight from the store — no render per change.
 * (Per row, not one custom property on the list: changing an inherited
 * property restyles every element of every row.)
 */
export function useTaskRowTracks(ref: RefObject<HTMLElement | null>): void {
  const store = useContext(TaskRowColumnsContext)
  useLayoutEffect(() => {
    const apply = () => {
      const el = ref.current
      if (el) el.style.gridTemplateColumns = store.get().template
    }
    apply()
    return store.subscribe(apply)
  }, [ref, store])
}
