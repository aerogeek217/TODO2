import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { ListInset, PersistedTodoItem, Person, Org } from '../../models'
import type { SlotKind } from '../../models/canvas-rails'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListInsetStore } from '../../stores/list-inset-store'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { ListDefinitionBody } from './ListDefinitionBody'
import { DraggableTaskRow } from './shared/DraggableTaskRow'
import { WidgetHeader } from '../shared/WidgetHeader'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { convertFloatingKind } from '../../services/float-kind-switch'
import { copyTasksRich } from '../../services/task-copy'
import styles from './ListInsetNode.module.css'

// Re-exported for back-compat with existing call sites.
export { DraggableTaskRow }

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

function ListInsetNodeInner({ data }: NodeProps & { data: ListInsetNodeType }) {
  const { inset, onDelete, onOpenDetail, onResize, onResizeSnap, onSetAlignmentLines } = data
  const { getZoom } = useReactFlow()
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const definition = useListDefinitionStore((s) => s.listDefinitions.find(d => d.id === inset.listDefinitionId))
  const [count, setCount] = useState(0)
  const [listTodos, setListTodos] = useState<PersistedTodoItem[]>([])
  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const statuses = useStatusStore((s) => s.statuses)
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id!, s])), [statuses])

  useEffect(() => () => { resizeCleanupRef.current?.() }, [])

  const headerLabel = definition?.name ?? '(Deleted list)'
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

  const handleSelectList = (listDefinitionId: number) => {
    if (inset.id == null) return
    const store = useListInsetStore.getState()
    const current = store.insets.find((i) => i.id === inset.id)
    if (!current) return
    // Clear any stale runtime-filter pick when the list-def changes — the new
    // def's runtime-filter field may be different or absent.
    const { runtimeFilterValue: _drop, ...rest } = current
    void _drop
    void store.update({ ...rest, listDefinitionId })
  }

  const handleRuntimeFilterChange = useCallback((value: number | undefined) => {
    if (inset.id == null) return
    const store = useListInsetStore.getState()
    const current = store.insets.find((i) => i.id === inset.id)
    if (!current) return
    if (value == null) {
      const { runtimeFilterValue: _drop, ...rest } = current
      void _drop
      void store.update(rest)
    } else {
      void store.update({ ...current, runtimeFilterValue: value })
    }
  }, [inset.id])

  return (
    <div className={styles.inset} style={{ width: inset.width }}>
      <WidgetHeader
        kind="lens"
        title={headerLabel}
        meta={
          <>
            <span>{count}</span>
            <button
              type="button"
              className={`${styles.exportButton} nopan nodrag`}
              onClick={() => {
                void copyTasksRich(
                  [{ todos: listTodos }],
                  { assignedPeopleMap, statusMap },
                )
              }}
              aria-label="Copy tasks"
              title="Copy tasks"
            >
              ⧉
            </button>
          </>
        }
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

      <div
        className={`${inset.isCollapsed ? styles.collapsedBody : styles.body} nopan nodrag nowheel`}
        style={!inset.isCollapsed ? { maxHeight: inset.height || 300 } : undefined}
      >
        <ListDefinitionBody
          listDefinitionId={inset.listDefinitionId}
          onResult={({ count, todos }) => { setCount(count); setListTodos(todos) }}
          emptyClassName={styles.emptyMessage}
          runtimeFilterValue={inset.runtimeFilterValue}
          onRuntimeFilterChange={handleRuntimeFilterChange}
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
            onPointerDown={(e) => {
              e.stopPropagation()
              resizeCleanupRef.current?.()
              const handle = e.currentTarget as HTMLDivElement
              const pointerId = e.pointerId
              try { handle.setPointerCapture(pointerId) } catch { /* noop */ }

              const startY = e.clientY
              const startH = inset.height || 300
              const zoom = getZoom()
              const insetEl = handle.closest('.react-flow__node')
              const bodyEl = insetEl?.querySelector('.' + styles.body) as HTMLElement | null
              let active = true

              const onPointerMove = (ev: PointerEvent) => {
                if (!active) return
                const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
                if (bodyEl) bodyEl.style.maxHeight = `${newH}px`
              }

              const onPointerUp = (ev: PointerEvent) => {
                if (!active) return
                const newH = Math.max(100, startH + (ev.clientY - startY) / zoom)
                if (inset.id && onResize) onResize(inset.id, inset.width, Math.round(newH))
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
          <div
            className={`${styles.cornerHandle} nopan nodrag`}
            onPointerDown={(e) => {
              e.stopPropagation()
              resizeCleanupRef.current?.()
              const handle = e.currentTarget as HTMLDivElement
              const pointerId = e.pointerId
              try { handle.setPointerCapture(pointerId) } catch { /* noop */ }

              const startX = e.clientX
              const startY = e.clientY
              const startW = inset.width
              const startH = inset.height || 300
              const zoom = getZoom()
              const nodeId = `inset-${inset.id}`
              const insetEl = handle.closest('.react-flow__node')
              const insetDiv = insetEl?.querySelector('.' + styles.inset) as HTMLElement | null
              const bodyEl = insetEl?.querySelector('.' + styles.body) as HTMLElement | null
              let active = true

              const onPointerMove = (ev: PointerEvent) => {
                if (!active) return
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

              const onPointerUp = (ev: PointerEvent) => {
                if (!active) return
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
        </>
      )}

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onPointerDown={(e) => {
          e.stopPropagation()
          resizeCleanupRef.current?.()
          const handle = e.currentTarget as HTMLDivElement
          const pointerId = e.pointerId
          try { handle.setPointerCapture(pointerId) } catch { /* noop */ }

          const startX = e.clientX
          const startW = inset.width
          const zoom = getZoom()
          const nodeId = `inset-${inset.id}`
          const insetEl = handle.closest('.react-flow__node')
          const insetDiv = insetEl?.querySelector('.' + styles.inset) as HTMLElement | null
          let active = true

          const onPointerMove = (ev: PointerEvent) => {
            if (!active) return
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

          const onPointerUp = (ev: PointerEvent) => {
            if (!active) return
            let newW = Math.max(220, startW + (ev.clientX - startX) / zoom)
            if (onResizeSnap) {
              newW = onResizeSnap(nodeId, newW).width
            }
            onSetAlignmentLines?.([])
            if (inset.id && onResize) onResize(inset.id, Math.round(newW), inset.height)
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
          currentKind="lens"
          onChangeKind={(k) => { void handleChangeKind(k) }}
          pickListForLens={handleSelectList}
          onClose={() => setKindAnchor(null)}
          secondaryLabel={definition ? `Change list (${definition.name})…` : undefined}
        />
      )}
    </div>
  )
}

export const ListInsetNode = memo(ListInsetNodeInner)
