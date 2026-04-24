import { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { FloatingCalendar, PersistedTodoItem, Person, Org, Status, Tag } from '../../models'
import type { SlotKind } from '../../models/canvas-rails'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useTagStore } from '../../stores/tag-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { useFloatingCalendarStore } from '../../stores/floating-calendar-store'
import { useFilterStore, applyFilter } from '../../stores/filter-store'
import { startOfDay } from '../../utils/date'
import { CalendarStrip } from './rails/CalendarStrip'
import { CalendarOrientationToggle } from './rails/calendar/CalendarOrientationToggle'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { convertFloatingKind } from '../../services/float-kind-switch'
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

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

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

  const handleDelete = useCallback(() => {
    if (calendar.id != null) onDelete(calendar.id)
  }, [calendar.id, onDelete])

  const handleDock = useCallback(() => {
    if (calendar.id == null) return
    useCanvasRailsStore.getState().createAndDockSlot('calendar')
    onDelete(calendar.id)
  }, [calendar.id, onDelete])

  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)

  const handleChangeKind = useCallback(async (nextKind: SlotKind) => {
    if (calendar.id == null) return
    if (nextKind === 'calendar') return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    await convertFloatingKind({
      sourceKind: 'calendar',
      sourceId: calendar.id,
      canvasId,
      rect: { x: calendar.x, y: calendar.y, width, height },
      nextKind,
    })
  }, [calendar.id, calendar.x, calendar.y, width, height])

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
        onDock={handleDock}
        onClose={handleDelete}
        onTitleClick={(a) => setKindAnchor(a)}
        titleMenuOpen={kindAnchor !== null}
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

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onPointerDown={(e) => {
          e.stopPropagation()
          resizeCleanupRef.current?.()
          const handle = e.currentTarget as HTMLDivElement
          const pointerId = e.pointerId
          try { handle.setPointerCapture(pointerId) } catch { /* noop */ }

          const startX = e.clientX
          const startY = e.clientY
          const startW = width
          const startH = height
          const zoom = getZoom()
          const nodeEl = handle.closest('.react-flow__node')
          const calDiv = nodeEl?.querySelector('.' + styles.calendar) as HTMLElement | null
          let active = true

          const onPointerMove = (ev: PointerEvent) => {
            if (!active) return
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const newW = Math.max(260, startW + dx / zoom)
            const newH = Math.max(200, startH + dy / zoom)
            if (calDiv) {
              calDiv.style.width = `${newW}px`
              calDiv.style.height = `${newH}px`
            }
          }

          const onPointerUp = (ev: PointerEvent) => {
            if (!active) return
            const newW = Math.max(260, startW + (ev.clientX - startX) / zoom)
            const newH = Math.max(200, startH + (ev.clientY - startY) / zoom)
            if (calendar.id != null && onResize) onResize(calendar.id, newW, newH)
            cleanup()
          }

          const cleanup = () => {
            active = false
            handle.removeEventListener('pointermove', onPointerMove)
            handle.removeEventListener('pointerup', onPointerUp)
            handle.removeEventListener('pointercancel', onPointerUp)
            try {
              if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
            } catch { /* noop */ }
            resizeCleanupRef.current = null
          }
          resizeCleanupRef.current = cleanup
          handle.addEventListener('pointermove', onPointerMove)
          handle.addEventListener('pointerup', onPointerUp)
          handle.addEventListener('pointercancel', onPointerUp)
        }}
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
