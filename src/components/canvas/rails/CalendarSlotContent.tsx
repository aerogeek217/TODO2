import { useEffect, useMemo, useState } from 'react'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useOrgStore } from '../../../stores/org-store'
import { useStatusStore } from '../../../stores/status-store'
import { useUIStore } from '../../../stores/ui-store'
import { useFilterStore, applyFilter } from '../../../stores/filter-store'
import { startOfDay } from '../../../utils/date'
import { TwoWeekCalendarStrip } from './TwoWeekCalendarStrip'

export function CalendarSlotContent() {
  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const statuses = useStatusStore((s) => s.statuses)
  const { filters } = useFilterStore()
  const openEditPopup = useUIStore((s) => s.openEditPopup)

  const [today, setToday] = useState(() => startOfDay(new Date()))

  useEffect(() => {
    const refresh = () => {
      const now = startOfDay(new Date())
      setToday((prev) => (prev.getTime() === now.getTime() ? prev : now))
    }
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(refresh, Math.max(1000, nextMidnight - now.getTime() + 50))
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [today])

  const activeTodos = useMemo(
    () => applyFilter(filters, todos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses),
    [filters, todos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses],
  )

  return (
    <TwoWeekCalendarStrip todos={activeTodos} today={today} onOpenTodo={openEditPopup} />
  )
}
