import { useEffect, useMemo, useState } from 'react'
import type { PersistedTodoItem, TodoPredicate } from '../../../models'
import { useFilterStore, applyFilter, matchesFilter, predicateToCriteria, computeFilterPersonOrgIds } from '../../../stores/filter-store'
import { useStatusStore } from '../../../stores/status-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useOrgStore } from '../../../stores/org-store'
import { useUIStore } from '../../../stores/ui-store'
import { buildDashboardLists } from '../../../services/dashboard-lists'
import { startOfToday } from '../../../utils/date'
import { TaskRow } from '../../task/TaskRow'
import styles from './LensSlotContent.module.css'

interface LensSlotContentProps {
  listDefinitionId: number | undefined
  onTitleChange?: (title: string, count: number) => void
}

export function LensSlotContent({ listDefinitionId, onTitleChange }: LensSlotContentProps) {
  const { filters } = useFilterStore()
  const statuses = useStatusStore((s) => s.statuses)
  const definition = useListDefinitionStore((s) =>
    listDefinitionId != null ? s.listDefinitions.find((d) => d.id === listDefinitionId) : undefined,
  )
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  // Roll membership at midnight.
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
    const globalFiltered = applyFilter(
      filters, todos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses,
    )
    const today = startOfToday()
    const hiddenStatusIds = new Set(statuses.filter((s) => s.hideByDefault).map((s) => s.id!))
    const evalPredicate = (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const people = assignedPeopleMap.get(todo.id) ?? []
      const personIds = people.map((p) => p.id!)
      const tagIds = (assignedTagsMap.get(todo.id) ?? []).map((t) => t.id!)
      const personOrgIds = people.flatMap((p) => personOrgMap.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap.get(todo.id) ?? []).map((o) => o.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(
        criteria.personIds, criteria.personFilterMode, personOrgMap,
      )
      return matchesFilter(
        criteria, todo, personIds, tagIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today,
      )
    }
    const [list] = buildDashboardLists([definition], globalFiltered, {
      today,
      hiddenStatusIds,
      showCompleted: true,
      showHiddenStatuses: true,
      evalPredicate,
    })
    return list?.todos ?? []
  }, [
    definition, todos, filters, assignedPeopleMap, assignedTagsMap,
    assignedOrgsMap, personOrgMap, statuses, dayKey,
  ])

  useEffect(() => {
    if (onTitleChange) {
      onTitleChange(definition?.name ?? '(Deleted list)', filteredTodos.length)
    }
  }, [definition?.name, filteredTodos.length, onTitleChange])

  if (!definition) {
    return <div className={styles.empty}>No list configured</div>
  }

  if (filteredTodos.length === 0) {
    return <div className={styles.empty}>No tasks</div>
  }

  return (
    <div className={styles.list}>
      {filteredTodos.map((todo) => (
        <TaskRow
          key={todo.id}
          todo={todo}
          assignedPeople={assignedPeopleMap.get(todo.id)}
          assignedTags={assignedTagsMap.get(todo.id)}
          onOpenDetail={() => openEditPopup(todo.id)}
          showContext
          compact
        />
      ))}
    </div>
  )
}
