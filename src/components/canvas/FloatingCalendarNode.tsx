import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { FloatingCalendar, PersistedTodoItem, Person, Org, Status } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useFilterStore, applyFilter } from '../../stores/filter-store'
import { startOfDay } from '../../utils/date'
import { TwoWeekCalendarStrip } from './rails/TwoWeekCalendarStrip'
import { WidgetHeader } from '../shared/WidgetHeader'
import styles from './FloatingCalendarNode.module.css'

export interface FloatingCalendarNodeData {
  calendar: FloatingCalendar
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingCalendarNodeInner({ data }: NodeProps & { data: FloatingCalendarNodeData }) {
  const { calendar, onDelete, onResize } = data
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
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

  const activeTodos: PersistedTodoItem[] = useMemo(
    () => applyFilter(
      filters,
      todos,
      assignedPeopleMap as Map<number, Person[]>,
      personOrgMap,
      assignedOrgsMap as Map<number, Org[]>,
      statuses as Status[],
    ),
    [filters, todos, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses],
  )

  const width = calendar.width
  const height = calendar.height

  const handleDelete = useCallback(() => {
    if (calendar.id != null) onDelete(calendar.id)
  }, [calendar.id, onDelete])

  const handleDock = useCallback(() => {
    if (calendar.id == null) return
    useCanvasRailsStore.getState().createAndDockSlot('calendar')
    onDelete(calendar.id)
  }, [calendar.id, onDelete])

  return (
    <div className={styles.calendar} style={{ width, height }}>
      <WidgetHeader
        kind="calendar"
        title="Calendar · next 2 wks"
        onDock={handleDock}
        onClose={handleDelete}
        floating
      />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <TwoWeekCalendarStrip todos={activeTodos} today={today} onOpenTodo={openEditPopup} />
      </div>

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const startY = e.clientY
          const startW = width
          const startH = height
          const zoom = getZoom()
          const nodeEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          const calDiv = nodeEl?.querySelector('.' + styles.calendar) as HTMLElement | null

          const onMouseMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const newW = Math.max(260, startW + dx / zoom)
            const newH = Math.max(200, startH + dy / zoom)
            if (calDiv) {
              calDiv.style.width = `${newW}px`
              calDiv.style.height = `${newH}px`
            }
          }

          const onMouseUp = (ev: MouseEvent) => {
            const newW = Math.max(260, startW + (ev.clientX - startX) / zoom)
            const newH = Math.max(200, startH + (ev.clientY - startY) / zoom)
            if (calendar.id != null && onResize) onResize(calendar.id, newW, newH)
            resizeCleanupRef.current?.()
          }

          const cleanup = () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            resizeCleanupRef.current = null
          }
          resizeCleanupRef.current = cleanup
          window.addEventListener('mousemove', onMouseMove)
          window.addEventListener('mouseup', onMouseUp)
        }}
      />
    </div>
  )
}

export const FloatingCalendarNode = memo(FloatingCalendarNodeInner)
