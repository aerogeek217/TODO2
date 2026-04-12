import { memo, useEffect, useMemo, useRef } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { ListInset, PersistedTodoItem, Person, Tag, Org } from '../../models'
import { Priority } from '../../models'
import { TaskRow } from '../task/TaskRow'
import { FollowupIcon } from '../shared/FollowupIcon'
import styles from './ListInsetNode.module.css'

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
  onDelete: (id: number) => void
  onToggleCollapse: (id: number) => void
  onOpenDetail?: (todoId: number) => void
  onResize?: (id: number, width: number, height: number) => void
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

function ListInsetNodeInner({ data }: NodeProps & { data: ListInsetNodeType }) {
  const { inset, allTodos, assignedPeopleMap, assignedTagsMap, assignedOrgsMap, onDelete, onToggleCollapse, onOpenDetail, onResize } = data
  const headerInfo = getInsetHeaderInfo(inset)
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  // Clean up resize listeners on unmount
  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  const filteredTodos = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekEnd = new Date(today)
    weekEnd.setDate(weekEnd.getDate() + 7)

    return allTodos.filter(todo => {
      if (todo.isCompleted) return false
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
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      }
      return a.sortOrder - b.sortOrder
    })
  }, [allTodos, inset.preset, inset.attributeFilter, assignedPeopleMap, assignedTagsMap, assignedOrgsMap])

  return (
    <div className={styles.inset} style={{ width: inset.width, height: inset.isCollapsed ? undefined : inset.height }}>
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

      <div className={`${inset.isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}>
        {filteredTodos.length === 0 ? (
          <div className={styles.emptyMessage}>No tasks</div>
        ) : (
          filteredTodos.map(todo => (
            <TaskRow
              key={todo.id}
              todo={todo}
              assignedPeople={assignedPeopleMap.get(todo.id)}
              assignedTags={assignedTagsMap?.get(todo.id)}
              onOpenDetail={onOpenDetail ? () => onOpenDetail(todo.id) : undefined}
              compact
            />
          ))
        )}
      </div>

      {/* Resize handle */}
      {!inset.isCollapsed && (
        <div
          className={`${styles.resizeHandle} nopan nodrag`}
          onMouseDown={(e) => {
            e.stopPropagation()
            const startX = e.clientX
            const startY = e.clientY
            const startW = inset.width
            const startH = inset.height
            const zoom = getZoom()
            const insetEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
            const insetDiv = insetEl?.querySelector('.' + styles.inset) as HTMLElement | null

            const onMouseMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX
              const dy = ev.clientY - startY
              const newW = Math.max(220, startW + dx / zoom)
              const newH = Math.max(120, startH + dy / zoom)

              if (insetDiv) {
                insetDiv.style.width = `${newW}px`
                insetDiv.style.height = `${newH}px`
              }
            }

            const onMouseUp = (ev: MouseEvent) => {
              const newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
              const newH = Math.max(120, startH + (ev.clientY - startY) / zoom)

              if (inset.id && onResize) onResize(inset.id, newW, newH)

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
      )}
    </div>
  )
}

export const ListInsetNode = memo(ListInsetNodeInner)
