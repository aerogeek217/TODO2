import { memo, type CSSProperties } from 'react'
import type { PersistedTodoItem, Person } from '../../models'
import { useSettingsStore } from '../../stores/settings-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { startOfToday } from '../../utils/date'
import { rowSummaryText, rowTone, stripWidthPct } from '../../utils/list-zoom'
import { isStale } from '../../utils/stale'
import { subtaskCount } from '../../utils/subtasks'
import { TODO_ID_ATTR } from '../../utils/dom-contract'
import { useTooltip } from '../shared/use-tooltip'
import { keepRowTextUnselected } from './row-events'
import styles from './TaskLine.module.css'

/** Modifier keys of a click that selects. */
export interface LineSelectMods {
  shift: boolean
  ctrl: boolean
}

/** A task's state as the compact levels draw it (`utils/list-zoom.rowTone`), with the Settings it reads. */
function useRowTone(todo: PersistedTodoItem, today: Date) {
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  return {
    tone: rowTone(todo, today, { urgentRange, staleAfterDays }),
    stale: isStale(todo, today, staleAfterDays),
  }
}

/** Cross-surface hover sync (the calendar's entry, the row elsewhere), as `TaskRow` does it. */
function hoverProps(todoId: number) {
  return {
    onMouseEnter: () => useUIStore.getState().setHoveredTodoId(todoId),
    onMouseLeave: () => useUIStore.getState().setHoveredTodoId(null),
  }
}

const NO_PEOPLE: readonly Person[] = []

/**
 * A task at the Lines zoom (D25 I1): a 15px line — a 3px state tick where
 * the checkbox was (late, due soon, follow-up late, stale or none:
 * `rowTone`) and the title alone at 10.5px, starting where a row's title
 * does. No cells: hovering shows what they'd say (`rowSummaryText`), a
 * click opens the editor (and selects the task); Shift / Ctrl-click only
 * selects. Its list wraps it as the drag source, as a row.
 */
export const TaskLine = memo(function TaskLine({ todo, assignedPeople, onSelect, onOpenDetail }: {
  todo: PersistedTodoItem
  assignedPeople?: readonly Person[]
  onSelect?: (todoId: number, mods: LineSelectMods) => void
  onOpenDetail?: (todoId: number) => void
}) {
  const today = startOfToday()
  const { tone, stale } = useRowTone(todo, today)
  const rowDates = useSettingsStore((s) => s.rowDates)
  const tags = useTagStore((s) => s.assignedTagsMap.get(todo.id))
  const subtasks = useSubtaskStore((s) => s.byTodo.get(todo.id))
  const hoveredSynced = useUIStore((s) => s.hoveredTodoId === todo.id)
  const people = assignedPeople ?? NO_PEOPLE
  const tip = rowSummaryText(todo, today, {
    rowDates,
    people: people.map((p) => p.name),
    tags: (tags ?? []).map((t) => t.name),
    count: subtasks && subtasks.length > 0 ? subtaskCount(subtasks) : null,
    stale,
  })
  const { triggerProps, tooltip } = useTooltip(tip)
  return (
    <div
      className={`${styles.line} ${todo.isCompleted ? styles.completed : ''}`}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-tone={tone}
      data-stale={stale || undefined}
      data-hovered-synced={hoveredSynced ? 'true' : undefined}
      data-task-line=""
      {...hoverProps(todo.id)}
      {...triggerProps}
      onMouseDown={keepRowTextUnselected}
      onClick={(e) => {
        e.stopPropagation()
        const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }
        onSelect?.(todo.id, mods)
        if (!mods.shift && !mods.ctrl) onOpenDetail?.(todo.id)
      }}
    >
      <span className={styles.tick} aria-hidden="true" />
      <span className={styles.title} data-task-title={todo.title}>{todo.title}</span>
      {tooltip}
    </div>
  )
})

/**
 * A task at the Strips zoom (D25 I1): a 3px bar in the tick's colours
 * (`rowTone`), as long as its title is (`stripWidthPct`), so a group's bars
 * read as a texture where the late ones cluster. Hovering shows the title;
 * a click zooms the list to Rows on this task (`onZoomTo`). No selection.
 */
export const TaskStrip = memo(function TaskStrip({ todo, onZoomTo }: {
  todo: PersistedTodoItem
  onZoomTo?: (todoId: number) => void
}) {
  const today = startOfToday()
  const { tone } = useRowTone(todo, today)
  const { triggerProps, tooltip } = useTooltip(todo.title)
  return (
    <div
      className={`${styles.strip} ${todo.isCompleted ? styles.completed : ''}`}
      {...{ [TODO_ID_ATTR]: todo.id }}
      data-tone={tone}
      data-task-strip=""
      aria-label={todo.title}
      {...hoverProps(todo.id)}
      {...triggerProps}
      onClick={(e) => {
        e.stopPropagation()
        onZoomTo?.(todo.id)
      }}
    >
      <span className={styles.bar} style={{ width: `${stripWidthPct(todo.title)}%` } as CSSProperties} aria-hidden="true" />
      {tooltip}
    </div>
  )
})
