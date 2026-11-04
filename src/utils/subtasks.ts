import { SUBTASK_TITLE_MAX, type Subtask } from '../models/subtask'
import { collapseWhitespace } from './text'

/** The one order of a task's checklist: by `sortOrder`, then by `id` (rows written together). */
export function compareSubtasks(
  a: Pick<Subtask, 'sortOrder' | 'id'>,
  b: Pick<Subtask, 'sortOrder' | 'id'>,
): number {
  return a.sortOrder - b.sortOrder || (a.id ?? 0) - (b.id ?? 0)
}

/**
 * A subtask's title as stored: one line (runs of whitespace, line breaks
 * included, as one space), trimmed, at most `SUBTASK_TITLE_MAX` characters.
 * Empty = no subtask.
 */
export function subtaskTitle(title: string): string {
  return collapseWhitespace(title).slice(0, SUBTASK_TITLE_MAX).trim()
}

/** A checklist's count: how many are done, of how many. */
export interface SubtaskCount {
  done: number
  total: number
}

export function subtaskCount(subtasks: readonly Pick<Subtask, 'isCompleted'>[]): SubtaskCount {
  let done = 0
  for (const s of subtasks) if (s.isCompleted) done++
  return { done, total: subtasks.length }
}

/** The count as a row shows it: `2/5`. */
export function formatSubtaskCount({ done, total }: SubtaskCount): string {
  return `${done}/${total}`
}

/** The count in words, for a label or a tooltip: `2 of 5 subtasks done`. */
export function describeSubtaskCount({ done, total }: SubtaskCount): string {
  return `${done} of ${total} ${total === 1 ? 'subtask' : 'subtasks'} done`
}

/** The next `sortOrder` for a subtask going last in `subtasks`. */
export function nextSubtaskOrder(subtasks: readonly Pick<Subtask, 'sortOrder'>[]): number {
  let max = -1
  for (const s of subtasks) if (s.sortOrder > max) max = s.sortOrder
  return max + 1
}
