import { memo, useEffect, useMemo, useState } from 'react'
import { type NodeProps } from '@xyflow/react'
import type { FloatingCalendar, PersistedTodoItem, Person, Org, Status, Tag } from '../../models'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useFloatingCalendarStore } from '../../stores/floating-calendar-store'
import { useFilterStore, applyFilter } from '../../stores/filter-store'
import { startOfDay } from '../../utils/date'
import { CalendarStrip } from './rails/CalendarStrip'
import { CalendarOrientationToggle } from './rails/calendar/CalendarOrientationToggle'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useFloatingWidget } from '../../hooks/use-floating-widget'
import styles from './FloatingCalendarNode.module.css'

export interface FloatingCalendarNodeData {
  calendar: FloatingCalendar
  onDelete: (id: number) => void
  onResize?: (id: number, width: number, height: number) => void
}

function FloatingCalendarNodeInner({ data }: NodeProps & { data: FloatingCalendarNodeData }) {
  const { calendar, onDelete, onResize } = data

  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
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
      undefined,
      undefined,
      assignedTagsMap as Map<number, Tag[]>,
    ),
    [filters, todos, assignedPeopleMap, personOrgMap, assignedOrgsMap, statuses, assignedTagsMap],
  )

  const width = calendar.width
  const height = calendar.height
  const orientation = calendar.orientation ?? 'vertical'
  const weekOffset = calendar.weekOffset ?? 0

  const updateOrientation = useFloatingCalendarStore((s) => s.updateOrientation)
  const updateWeekOffset = useFloatingCalendarStore((s) => s.updateWeekOffset)

  const { headerProps, handleChangeKind, kindAnchor, setKindAnchor } = useFloatingWidget({
    kind: 'calendar',
    id: calendar.id,
    rect: { x: calendar.x, y: calendar.y, width, height },
    onDelete,
  })

  return (
    <div className={styles.calendar} style={{ width, height }}>
      <WidgetHeader
        kind="calendar"
        title="Calendar"
        meta={(
          <CalendarOrientationToggle
            orientation={orientation}
            onChange={(o) => { if (calendar.id != null) void updateOrientation(calendar.id, o) }}
          />
        )}
        {...headerProps}
        floating
      />

      <div className={`${styles.body} nopan nodrag nowheel`}>
        <CalendarStrip
          todos={activeTodos}
          today={today}
          orientation={orientation}
          weekOffset={weekOffset}
          assignedPeopleMap={assignedPeopleMap as Map<number, Person[]>}
          assignedOrgsMap={assignedOrgsMap as Map<number, Org[]>}
          statuses={statuses as Status[]}
          onOpenTodo={openEditPopup}
          onWeekOffsetChange={(n) => { if (calendar.id != null) void updateWeekOffset(calendar.id, n) }}
          scope={`float-${calendar.id ?? 'unset'}`}
        />
      </div>

      <ResizeHandle
        axis="xy"
        width={width}
        height={height}
        minW={260}
        minH={200}
        className={`${styles.resizeHandle} nopan nodrag`}
        bodySelector={`.${styles.calendar}`}
        onResize={(w, h) => { if (calendar.id != null) onResize?.(calendar.id, w, h) }}
      />
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="calendar"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onClose={() => setKindAnchor(null)}
        />
      )}
    </div>
  )
}

export const FloatingCalendarNode = memo(FloatingCalendarNodeInner)
