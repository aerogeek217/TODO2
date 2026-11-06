import { useEffect, useMemo } from 'react'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useStatusUpdateStore } from '../stores/status-update-store'
import { useSubtaskStore } from '../stores/subtask-store'
import { useTagStore } from '../stores/tag-store'
import { todoNameLookups, type TodoNameLookups } from '../utils/filter'
import type { Person, Tag } from '../models'
import type { PersistedStatusUpdate } from '../models/status-update'
import type { PersistedSubtask } from '../models/subtask'

const NO_PEOPLE: ReadonlyMap<number, readonly Person[]> = new Map()
const NO_TAGS: ReadonlyMap<number, readonly Tag[]> = new Map()
const NO_UPDATES: ReadonlyMap<number, readonly PersistedStatusUpdate[]> = new Map()
const NO_SUBTASKS: ReadonlyMap<number, readonly PersistedSubtask[]> = new Map()

/**
 * The text search's lookups (`utils/filter.todoNameLookups`) over the
 * stores, kept current: the people and tag assignment maps, the statuses,
 * every task's status updates and subtasks. `ensureLoaded`: load the status
 * updates and subtasks too (a surface that may be their only reader — a
 * list widget, a list tab's badge). `active: false`: not searching now, so
 * the per-task maps stay empty and their writes don't re-render (the top
 * bar while its search dropdown can't show).
 */
export function useTodoNameLookups(
  { ensureLoaded = false, active = true }: { ensureLoaded?: boolean; active?: boolean } = {},
): TodoNameLookups {
  const assignedPeopleMap = usePersonStore((s) => (active ? s.assignedPeopleMap : NO_PEOPLE))
  const assignedTagsMap = useTagStore((s) => (active ? s.assignedTagsMap : NO_TAGS))
  const statuses = useStatusStore((s) => s.statuses)
  const statusUpdatesByTodo = useStatusUpdateStore((s) => (active ? s.byTodo : NO_UPDATES))
  const subtasksByTodo = useSubtaskStore((s) => (active ? s.byTodo : NO_SUBTASKS))

  useEffect(() => {
    if (!ensureLoaded) return
    void useStatusUpdateStore.getState().ensureLoaded()
    void useSubtaskStore.getState().ensureLoaded()
  }, [ensureLoaded])

  return useMemo(
    () => todoNameLookups({ assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo, subtasksByTodo }),
    [assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo, subtasksByTodo],
  )
}
