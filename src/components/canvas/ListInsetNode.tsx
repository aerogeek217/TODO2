import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useDraggable } from '@dnd-kit/core'
import type { ListInset, PersistedTodoItem, Person, Org, TodoPredicate } from '../../models'
import type { SlotKind } from '../../models/canvas-rails'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListInsetStore } from '../../stores/list-inset-store'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { TaskRow } from '../task/TaskRow'
import { ListDefinitionBody } from './ListDefinitionBody'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../overlays/ListDefinitionPickerPopup'
import { convertFloatingKind } from '../../services/float-kind-switch'
import styles from './ListInsetNode.module.css'

export function DraggableTaskRow({
  todo,
  assignedPeople,
  onOpenDetail,
}: {
  todo: PersistedTodoItem
  assignedPeople?: Person[]
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
  if (p.orgIds?.length) parts.push(`${p.orgIds.length} org filter`)
  if (p.statusIds?.length) parts.push(`${p.statusIds.length} status filter`)
  if (p.dateRangeStart || p.dateRangeEnd) parts.push('date range')
  if (p.searchText) parts.push(`search: "${p.searchText}"`)
  return parts.length > 0 ? parts.join(' · ') : 'All tasks'
}

function describeMembership(def: PersistedListDefinition): string {
  return describePredicate(def.membership.predicate)
}

function ListInsetNodeInner({ data }: NodeProps & { data: ListInsetNodeType }) {
  const { inset, onDelete, onOpenDetail, onResize, onResizeSnap, onSetAlignmentLines } = data
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const definition = useListDefinitionStore((s) => s.listDefinitions.find(d => d.id === inset.listDefinitionId))
  const [count, setCount] = useState(0)
  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)
  const [listPickerAnchor, setListPickerAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  const headerLabel = definition?.name ?? '(Deleted list)'
  const subtitle = definition ? describeMembership(definition) : 'Referenced list was deleted'
  const height = inset.height ?? 300

  const handleChangeKind = useCallback(async (nextKind: SlotKind) => {
    if (inset.id == null) return
    if (nextKind === 'lens') return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    await convertFloatingKind({
      sourceKind: 'lens',
      sourceId: inset.id,
      canvasId,
      rect: { x: inset.x, y: inset.y, width: inset.width, height },
      nextKind,
    })
  }, [inset.id, inset.x, inset.y, inset.width, height])

  const handleOpenSecondary = () => {
    if (!kindAnchor) return
    setListPickerAnchor(kindAnchor)
    setKindAnchor(null)
  }

  const handleSelectList = (listDefinitionId: number) => {
    if (inset.id == null) return
    const store = useListInsetStore.getState()
    const current = store.insets.find((i) => i.id === inset.id)
    if (!current) return
    void store.update({ ...current, listDefinitionId })
  }

  return (
    <div className={styles.inset} style={{ width: inset.width }}>
      <WidgetHeader
        kind="lens"
        title={headerLabel}
        meta={count}
        onDock={() => {
          if (inset.id == null) return
          useCanvasRailsStore.getState().createAndDockSlot('lens', inset.listDefinitionId)
          onDelete(inset.id)
        }}
        onClose={() => inset.id && onDelete(inset.id)}
        onTitleClick={(a) => setKindAnchor(a)}
        titleMenuOpen={kindAnchor !== null}
        floating
      />

      {!inset.isCollapsed && <div className={styles.filterDesc}>{subtitle}</div>}

      <div
        className={`${inset.isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}
        style={!inset.isCollapsed ? { maxHeight: inset.height || 300 } : undefined}
      >
        <ListDefinitionBody
          listDefinitionId={inset.listDefinitionId}
          onResult={({ count }) => setCount(count)}
          emptyClassName={styles.emptyMessage}
          renderRow={({ todo, assignedPeople }) => (
            <DraggableTaskRow
              todo={todo}
              assignedPeople={assignedPeople}
              onOpenDetail={onOpenDetail}
            />
          )}
        />
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
      {kindAnchor && (
        <WidgetKindMenu
          anchor={kindAnchor}
          currentKind="lens"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          onOpenSecondary={handleOpenSecondary}
          onClose={() => setKindAnchor(null)}
          secondaryLabel={definition ? `Change list (${definition.name})…` : undefined}
        />
      )}
      {listPickerAnchor && (
        <ListDefinitionPickerPopup
          x={listPickerAnchor.x}
          y={listPickerAnchor.y}
          mode="canvas"
          onSelect={handleSelectList}
          onCreateNew={() => { /* inset doesn't host the editor; user can use dashboard */ }}
          onClose={() => setListPickerAnchor(null)}
        />
      )}
    </div>
  )
}

export const ListInsetNode = memo(ListInsetNodeInner)
