import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PersistedTodoItem, Person, TodoPredicate } from '../../models'
import {
  matchesFilter,
  predicateToCriteria,
  computeFilterPersonOrgIds,
} from '../../stores/filter-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { buildDashboardLists } from '../../services/dashboard-lists'
import { startOfToday } from '../../utils/date'
import { TaskRow } from '../task/TaskRow'

export interface ListDefinitionBodyRenderRowArgs {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  onOpenDetail: (todoId: number) => void
}

interface ListDefinitionBodyProps {
  listDefinitionId: number | undefined
  onResult?: (result: { name: string | null; count: number; todos: PersistedTodoItem[] }) => void
  renderRow?: (args: ListDefinitionBodyRenderRowArgs) => ReactNode
  showContext?: boolean
  compact?: boolean
  emptyLabel?: string
  className?: string
  emptyClassName?: string
}

/**
 * Shared body for `ListInsetNode` (canvas) and `LensSlotContent` (rails).
 * Reads global filter + membership stores, runs the definition through
 * `buildDashboardLists`, and renders a flat list via `renderRow` (or
 * `<TaskRow compact>` by default). `onResult` reports `{name, count}` so
 * callers can drive their title chrome without rebuilding the pipeline.
 */
export function ListDefinitionBody({
  listDefinitionId,
  onResult,
  renderRow,
  showContext,
  compact = true,
  emptyLabel = 'No tasks',
  className,
  emptyClassName,
}: ListDefinitionBodyProps) {
  const statuses = useStatusStore((s) => s.statuses)
  const definition = useListDefinitionStore((s) =>
    listDefinitionId != null ? s.listDefinitions.find((d) => d.id === listDefinitionId) : undefined,
  )
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const loadTagAssignments = useTagStore((s) => s.loadAssignments)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  // Tag filter predicate clauses read via `assignedTagsMap`; make sure the
  // map is populated for the current todo corpus. Mirrors people/org loads
  // in `CanvasPage` / `DashboardView` for the filter-store path.
  useEffect(() => {
    if (todos.length === 0) return
    loadTagAssignments(todos.map((t) => t.id))
  }, [todos, loadTagAssignments])

  // Date-sensitive predicates roll at midnight; re-key the memo on day change.
  const [dayKey, setDayKey] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  })
  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(() => {
      const d = new Date()
      setDayKey(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    }, Math.max(1000, nextMidnight - now.getTime() + 50))
    return () => clearTimeout(timer)
  }, [dayKey])

  const filteredTodos = useMemo(() => {
    if (!definition) return [] as PersistedTodoItem[]
    const today = startOfToday()
    const evalPredicate = (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const people = assignedPeopleMap.get(todo.id) ?? []
      const personIds = people.map((p) => p.id!)
      const personOrgIds = people.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      const assignedTagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(
        criteria.personIds, criteria.personFilterMode, personOrgMap,
      )
      return matchesFilter(
        criteria, todo, personIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today, undefined, assignedTagIds,
      )
    }
    const [list] = buildDashboardLists([definition], todos, {
      today,
      evalPredicate,
      assignedTagsMap,
    })
    return list?.todos ?? []
  }, [
    definition, todos, assignedPeopleMap,
    assignedOrgsMap, personOrgMap, assignedTagsMap, statuses, dayKey,
  ])

  useEffect(() => {
    if (!onResult) return
    onResult({ name: definition?.name ?? null, count: filteredTodos.length, todos: filteredTodos })
  }, [definition?.name, filteredTodos, onResult])

  if (filteredTodos.length === 0) {
    return <div className={emptyClassName}>{emptyLabel}</div>
  }

  return (
    <div className={className}>
      {filteredTodos.map((todo) => {
        const args: ListDefinitionBodyRenderRowArgs = {
          todo,
          assignedPeople: assignedPeopleMap.get(todo.id),
          onOpenDetail: openEditPopup,
        }
        if (renderRow) return <Fragment key={todo.id}>{renderRow(args)}</Fragment>
        return (
          <TaskRow
            key={todo.id}
            todo={todo}
            assignedPeople={args.assignedPeople}
            onOpenDetail={() => openEditPopup(todo.id)}
            showContext={showContext}
            compact={compact}
          />
        )
      })}
    </div>
  )
}
