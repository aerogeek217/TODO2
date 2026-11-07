import { createContext } from 'react'

/** Where a dropped task's lifted row (the page's drag overlay) goes once it's let go. */
export type TaskDropLanding =
  /**
   * Onto the dragged row where it is now: its new spot after a reorder in
   * its list (written at once), else back where it was picked up (a
   * cancel, a drop on nothing, a drop that changes nothing).
   */
  | 'settle'
  /**
   * Untilts and fades where it was let go: the drop changes the task by a
   * write (or a question first) the row follows later — a calendar day, an
   * Eisenhower pane, another group of its list.
   */
  | 'in-place'

/**
 * Tells the page how the task drop being handled lands (default: `settle`).
 * Called from a drop handler — a `DndContext` `onDragEnd` or a
 * `useDndMonitor` one — before the drag overlay's drop animation reads it.
 */
export const TaskDropLandingContext = createContext<(landing: TaskDropLanding) => void>(() => {})
