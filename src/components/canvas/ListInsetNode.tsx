import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useDraggable } from '@dnd-kit/core'
import type { ListInset, PersistedTodoItem, Person, Tag, Org, TodoPredicate } from '../../models'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useFilterStore, applyFilter, matchesFilter, predicateToCriteria, computeFilterPersonOrgIds } from '../../stores/filter-store'
import { useStatusStore } from '../../stores/status-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { buildDashboardLists } from '../../services/dashboard-lists'
import { TaskRow } from '../task/TaskRow'
import { startOfToday } from '../../utils/date'
import styles from './ListInsetNode.module.css'

export function DraggableTaskRow({
  todo,
  assignedPeople,
  assignedTags,
  onOpenDetail,
}: {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
  assignedTags?: Tag[]
  onOpenDetail?: (todoId: number) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `inset-todo-${todo.id}`,
    data: { type: 'task', todo },
  })

  return (
    <div
      ref={setNodeRef}
      data-inset-todo-id={todo.id}
      style={{ outline: 'none', opacity: isDragging ? 0 : undefined }}
      {...attributes}
      {...listeners}
    >
      <TaskRow
        todo={todo}
        assignedPeople={assignedPeople}
        assignedTags={assignedTags}
        onOpenDetail={onOpenDetail ? () => onOpenDetail(todo.id) : undefined}
        compact
      />
    </div>
  )
}

export interface ListInsetNodeData {
  inset: ListInset
  allTodos: PersistedTodoItem[]
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap?: Map<number, Tag[]>
  assignedOrgsMap?: Map<number, Org[]>
  personOrgMap?: Map<number, number[]>
  onDelete: (id: number) => void
  onToggleCollapse: (id: number) => void
  onOpenDetail?: (todoId: number) => void
  onResize?: (id: number, width: number, height: number) => void
  onResizeSnap?: (nodeId: string, newWidth: number) => { width: number; lines: { orientation: 'horizontal' | 'vertical'; position: number; start: number; end: number }[] }
  onSetAlignmentLines?: (lines: { orientation: 'horizontal' | 'vertical'; position: number; start: number; end: number }[]) => void
}

type ListInsetNodeType = ListInsetNodeData

/** Rough summary of a predicate, used as a subtitle below the inset header. */
function describePredicate(p: TodoPredicate): string {
  const parts: string[] = []
  if (p.personIds?.length) parts.push(`${p.personIds.length} person filter`)
  if (p.tagIds?.length) parts.push(`${p.tagIds.length} tag filter`)
  if (p.orgIds?.length) parts.push(`${p.orgIds.length} org filter`)
  if (p.statusIds?.length) parts.push(`${p.statusIds.length} status filter`)
  if (p.dateRangeStart || p.dateRangeEnd) parts.push('date range')
  if (p.searchText) parts.push(`search: "${p.searchText}"`)
  return parts.length > 0 ? parts.join(' · ') : 'All tasks'
}

function describeMembership(def: PersistedListDefinition): string {
  switch (def.membership.kind) {
    case 'today': return 'Today (overdue + due within window)'
    case 'upcoming': return 'Upcoming tasks'
    case 'deadlines': return 'Tasks with a deadline'
    case 'someday': return 'Tasks with no date'
    case 'custom': return describePredicate(def.membership.predicate)
  }
}

function ListInsetNodeInner({ data }: NodeProps & { data: ListInsetNodeType }) {
  const { inset, allTodos, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, personOrgMap, onDelete, onToggleCollapse, onOpenDetail, onResize, onResizeSnap, onSetAlignmentLines } = data
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const { filters } = useFilterStore()
  const statuses = useStatusStore((s) => s.statuses)
  const definition = useListDefinitionStore((s) => s.listDefinitions.find(d => d.id === inset.listDefinitionId))

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  // Date-sensitive membership (today/upcoming/deadlines) rolls at midnight;
  // tick the day key so the memo recomputes even when no other props change.
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

    // Global filter first (parity with pre-v23 behavior) — narrows by person/
    // tag/org/status selections plus showCompleted + showHiddenStatuses gates.
    const globalFiltered = applyFilter(filters, allTodos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap, statuses)

    const today = startOfToday()
    const hiddenStatusIds = new Set(statuses.filter(s => s.hideByDefault).map(s => s.id!))
    const evalPredicate = (predicate: TodoPredicate, todo: PersistedTodoItem) => {
      const criteria = predicateToCriteria(predicate)
      const people = assignedPeopleMap.get(todo.id) ?? []
      const personIds = people.map(p => p.id!)
      const tagIds = (assignedTagsMap?.get(todo.id) ?? []).map(t => t.id!)
      const personOrgIds = people.flatMap(p => personOrgMap?.get(p.id!) ?? [])
      const directOrgIds = (assignedOrgsMap?.get(todo.id) ?? []).map(o => o.id!)
      const filterPersonOrgIds = computeFilterPersonOrgIds(criteria.personIds, criteria.personFilterMode, personOrgMap ?? new Map<number, number[]>())
      return matchesFilter(criteria, todo, personIds, tagIds, personOrgIds, directOrgIds, filterPersonOrgIds, statuses, today)
    }

    const [list] = buildDashboardLists([definition], globalFiltered, {
      today,
      hiddenStatusIds,
      showCompleted: true,            // already applied by applyFilter above
      showHiddenStatuses: true,       // same
      evalPredicate,
    })
    return list?.todos ?? []
  }, [
    definition, allTodos, filters, assignedPeopleMap, assignedTagsMap,
    assignedOrgsMap, personOrgMap, statuses, dayKey,
  ])

  const headerLabel = definition?.name ?? '(Deleted list)'
  const subtitle = definition ? describeMembership(definition) : 'Referenced list was deleted'

  return (
    <div className={styles.inset} style={{ width: inset.width }}>
      <div className={styles.titleBar}>
        <button
          className={`${styles.collapseButton} ${inset.isCollapsed ? styles.collapsed : ''}`}
          onClick={() => inset.id && onToggleCollapse(inset.id)}
        >
          &#9662;
        </button>
        <span className={styles.presetIcon}>{'\u{1F4CB}'}</span>
        <span className={styles.insetName}>{headerLabel}</span>
        <span className={styles.taskCount}>{filteredTodos.length}</span>
        <button
          className={styles.deleteButton}
          onClick={() => inset.id && onDelete(inset.id)}
        >
          &times;
        </button>
      </div>

      {!inset.isCollapsed && <div className={styles.filterDesc}>{subtitle}</div>}

      <div
        className={`${inset.isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}
        style={!inset.isCollapsed ? { maxHeight: inset.height || 300 } : undefined}
      >
        {filteredTodos.length === 0 ? (
          <div className={styles.emptyMessage}>No tasks</div>
        ) : (
          filteredTodos.map(todo => (
              <DraggableTaskRow
                key={todo.id}
                todo={todo}
                assignedPeople={assignedPeopleMap.get(todo.id)}
                assignedTags={assignedTagsMap?.get(todo.id)}
                onOpenDetail={onOpenDetail}
              />
          ))
        )}
      </div>

      {!inset.isCollapsed && (
        <>
          <div
            className={`${styles.bottomHandle} nopan nodrag`}
            onMouseDown={(e) => {
              e.stopPropagation()
              resizeCleanupRef.current?.()
              const startY = e.clientY
              const startH = inset.height || 300
              const zoom = getZoom()
              const insetEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
              const bodyEl = insetEl?.querySelector('.' + styles.body) as HTMLElement | null

              const onMouseMove = (ev: MouseEvent) => {
                const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
                if (bodyEl) bodyEl.style.maxHeight = `${newH}px`
              }

              const onMouseUp = (ev: MouseEvent) => {
                const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
                if (inset.id && onResize) onResize(inset.id, inset.width, Math.round(newH))
                cleanup()
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
          <div
            className={`${styles.cornerHandle} nopan nodrag`}
            onMouseDown={(e) => {
              e.stopPropagation()
              resizeCleanupRef.current?.()
              const startX = e.clientX
              const startY = e.clientY
              const startW = inset.width
              const startH = inset.height || 300
              const zoom = getZoom()
              const nodeId = `inset-${inset.id}`
              const insetEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
              const insetDiv = insetEl?.querySelector('.' + styles.inset) as HTMLElement | null
              const bodyEl = insetEl?.querySelector('.' + styles.body) as HTMLElement | null

              const onMouseMove = (ev: MouseEvent) => {
                let newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
                const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
                if (onResizeSnap) {
                  const snap = onResizeSnap(nodeId, newW)
                  newW = snap.width
                  onSetAlignmentLines?.(snap.lines)
                }
                if (insetDiv) insetDiv.style.width = `${newW}px`
                if (bodyEl) bodyEl.style.maxHeight = `${newH}px`
              }

              const onMouseUp = (ev: MouseEvent) => {
                let newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
                const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
                if (onResizeSnap) {
                  newW = onResizeSnap(nodeId, newW).width
                }
                onSetAlignmentLines?.([])
                if (inset.id && onResize) onResize(inset.id, Math.round(newW), Math.round(newH))
                cleanup()
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
        </>
      )}

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onMouseDown={(e) => {
          e.stopPropagation()
          resizeCleanupRef.current?.()
          const startX = e.clientX
          const startW = inset.width
          const zoom = getZoom()
          const nodeId = `inset-${inset.id}`
          const insetEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          const insetDiv = insetEl?.querySelector('.' + styles.inset) as HTMLElement | null

          const onMouseMove = (ev: MouseEvent) => {
            let newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
            if (onResizeSnap) {
              const snap = onResizeSnap(nodeId, newW)
              newW = snap.width
              onSetAlignmentLines?.(snap.lines)
            }
            if (insetDiv) {
              insetDiv.style.width = `${newW}px`
            }
          }

          const onMouseUp = (ev: MouseEvent) => {
            let newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
            if (onResizeSnap) {
              newW = onResizeSnap(nodeId, newW).width
            }
            onSetAlignmentLines?.([])
            if (inset.id && onResize) onResize(inset.id, Math.round(newW), inset.height)
            cleanup()
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

export const ListInsetNode = memo(ListInsetNodeInner)
