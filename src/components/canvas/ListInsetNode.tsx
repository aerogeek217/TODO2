import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useDraggable } from '@dnd-kit/core'
import type { ListInset, PersistedTodoItem, Person, Tag, Org } from '../../models'
import { Priority } from '../../models'
import { useFilterStore } from '../../stores/filter-store'
import { TaskRow } from '../task/TaskRow'
import { FollowupIcon } from '../shared/FollowupIcon'
import { bySortOrder } from '../../utils/hierarchy'
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

const PRESET_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  'due-this-week': { icon: '\u{1F4C5}', label: 'Due & Overdue' },
  'starred': { icon: <FollowupIcon filled />, label: 'Follow up' },
  'high-priority': { icon: '\u{1F534}', label: 'High Priority' },
}

const PRIORITY_LABELS: Record<number, string> = {
  [Priority.High]: 'High Priority',
  [Priority.Medium]: 'Medium Priority',
  [Priority.Normal]: 'Normal Priority',
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

function getInsetHeaderInfo(inset: ListInset): { icon: React.ReactNode; label: string } {
  if (inset.preset) {
    return PRESET_CONFIG[inset.preset]
  }
  if (inset.attributeFilter) {
    switch (inset.attributeFilter.type) {
      case 'priority':
        return { icon: '\u25CF', label: PRIORITY_LABELS[inset.attributeFilter.priority] || 'Priority' }
      case 'person':
        return { icon: '@', label: inset.attributeFilter.personName }
      case 'tag':
        return { icon: '#', label: inset.attributeFilter.tagName }
      case 'org':
        return { icon: '@', label: inset.attributeFilter.orgName }
    }
  }
  return { icon: '\u{1F4CB}', label: inset.name }
}

function getFilterDescription(inset: ListInset): string {
  if (inset.preset) {
    switch (inset.preset) {
      case 'due-this-week': return 'Tasks due within 7 days or overdue'
      case 'starred': return 'Tasks marked for follow-up'
      case 'high-priority': return 'Tasks with high priority'
    }
  }
  if (inset.attributeFilter) {
    switch (inset.attributeFilter.type) {
      case 'priority': return `Tasks with ${(PRIORITY_LABELS[inset.attributeFilter.priority] || 'priority').toLowerCase()}`
      case 'person': return `Tasks assigned to ${inset.attributeFilter.personName}`
      case 'tag': return `Tasks tagged ${inset.attributeFilter.tagName}`
      case 'org': return `Tasks assigned to ${inset.attributeFilter.orgName}`
    }
  }
  return ''
}

function ListInsetNodeInner({ data }: NodeProps & { data: ListInsetNodeType }) {
  const { inset, allTodos, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, personOrgMap, onDelete, onToggleCollapse, onOpenDetail, onResize, onResizeSnap, onSetAlignmentLines } = data
  const headerInfo = getInsetHeaderInfo(inset)
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const { filters, applyFilter } = useFilterStore()

  // Clean up resize listeners on unmount
  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  // Re-compute date-sensitive filters (e.g. due-this-week) across midnight.
  // Date-only presets bin todos relative to "today", which changes at midnight;
  // without this tick the memo would stale for presets left open overnight.
  const [dayKey, setDayKey] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  })
  useEffect(() => {
    if (inset.preset !== 'due-this-week') return
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const timer = setTimeout(() => {
      const d = new Date()
      setDayKey(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
    }, Math.max(1000, nextMidnight - now.getTime() + 50))
    return () => clearTimeout(timer)
  }, [inset.preset, dayKey])

  const filteredTodos = useMemo(() => {
    // Apply global filters first
    const globalFiltered = applyFilter(allTodos, assignedPeopleMap, assignedTagsMap, personOrgMap, assignedOrgsMap)

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekEnd = new Date(today)
    weekEnd.setDate(weekEnd.getDate() + 7)

    return globalFiltered.filter(todo => {
      // Attribute-based filter
      if (inset.attributeFilter) {
        switch (inset.attributeFilter.type) {
          case 'priority':
            return todo.priority === inset.attributeFilter.priority
          case 'person': {
            const assigned = assignedPeopleMap.get(todo.id)
            return assigned?.some(p => p.id === (inset.attributeFilter as { personId: number }).personId) ?? false
          }
          case 'tag': {
            const assigned = assignedTagsMap?.get(todo.id)
            return assigned?.some(t => t.id === (inset.attributeFilter as { tagId: number }).tagId) ?? false
          }
          case 'org': {
            const assigned = assignedOrgsMap?.get(todo.id)
            return assigned?.some(o => o.id === (inset.attributeFilter as { orgId: number }).orgId) ?? false
          }
        }
      }
      // Preset-based filter
      switch (inset.preset) {
        case 'due-this-week':
          if (!todo.dueDate) return false
          const due = new Date(todo.dueDate)
          return due <= weekEnd
        case 'starred':
          return todo.isStarred
        case 'high-priority':
          return todo.priority === Priority.High
        default:
          return false
      }
    }).sort((a, b) => {
      if (inset.preset === 'due-this-week' && a.dueDate && b.dueDate) {
        const aHard = a.isHardDeadline ? 1 : 0
        const bHard = b.isHardDeadline ? 1 : 0
        if (aHard !== bHard) return bHard - aHard
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      }
      return bySortOrder(a, b)
    })
  }, [allTodos, filters, inset.preset, inset.attributeFilter, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, personOrgMap, applyFilter, dayKey])

  return (
    <div className={styles.inset} style={{ width: inset.width }}>
      <div className={styles.titleBar}>
        <button
          className={`${styles.collapseButton} ${inset.isCollapsed ? styles.collapsed : ''}`}
          onClick={() => inset.id && onToggleCollapse(inset.id)}
        >
          &#9662;
        </button>
        <span className={styles.presetIcon}>{headerInfo.icon}</span>
        <span className={styles.insetName}>{headerInfo.label}</span>
        <span className={styles.taskCount}>{filteredTodos.length}</span>
        <button
          className={styles.deleteButton}
          onClick={() => inset.id && onDelete(inset.id)}
        >
          &times;
        </button>
      </div>

      {!inset.isCollapsed && <div className={styles.filterDesc}>{getFilterDescription(inset)}</div>}

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
