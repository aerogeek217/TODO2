import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { AppView } from '../../models'
import type { TodoPredicate } from '../../models'
import { useUIStore, type AttributeFilter } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useListInsetStore } from '../../stores/list-inset-store'
import { useListDefinitionStore, emptyPredicate } from '../../stores/list-definition-store'
import { useCanvasStore } from '../../stores/canvas-store'
import { useSettingsStore } from '../../stores/settings-store'
import { TaskRow } from '../task/TaskRow'
import { bySortOrder } from '../../utils/sort-order'
import styles from './FilteredListPopup.module.css'

function getHeaderInfo(filter: AttributeFilter): { label: string; icon: React.ReactNode } {
  switch (filter.type) {
    case 'person':
      return { label: filter.personName, icon: <span>@</span> }
    case 'org':
      return { label: filter.orgName, icon: <span style={filter.orgColor ? { color: filter.orgColor } : undefined}>@</span> }
  }
}

function filterToListDefName(filter: AttributeFilter): string {
  switch (filter.type) {
    case 'person': return `Tasks assigned to ${filter.personName}`
    case 'org': return `Tasks in ${filter.orgName}`
  }
}

function filterToPredicate(filter: AttributeFilter): TodoPredicate {
  const p = emptyPredicate()
  switch (filter.type) {
    case 'person': p.personIds = [filter.personId]; break
    case 'org': p.orgIds = [filter.orgId]; break
  }
  return p
}

/** Compute clamped position so the popup fits in the viewport. */
function computePosition(clickX: number, clickY: number) {
  const margin = 16
  const width = 380
  const maxH = window.innerHeight - margin * 2
  // Prefer placing below-right of click; flip if no room
  let x = clickX
  let y = clickY
  if (x + width > window.innerWidth - margin) {
    x = window.innerWidth - width - margin
  }
  if (x < margin) x = margin
  if (y < margin) y = margin
  const availableDown = window.innerHeight - y - margin
  const availableUp = y - margin
  // If more room above, flip
  if (availableDown < 200 && availableUp > availableDown) {
    // Place above the click, growing upward
    const maxHeight = Math.min(maxH, availableUp)
    return { x, y: y - maxHeight, maxHeight }
  }
  return { x, y, maxHeight: Math.min(maxH, availableDown) }
}

const DRAG_THRESHOLD = 8

export function FilteredListPopup() {
  const popup = useUIStore((s) => s.filteredListPopup)
  const hideFilteredList = useUIStore((s) => s.hideFilteredList)
  const activeView = useUIStore((s) => s.activeView)

  const todos = useTodoStore((s) => s.todos)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedOrgsMap = useOrgStore((s) => s.assignedOrgsMap)
  const openEditPopup = useUIStore((s) => s.openEditPopup)
  const addInset = useListInsetStore((s) => s.add)
  const addListDef = useListDefinitionStore((s) => s.add)
  const selectedCanvasId = useCanvasStore((s) => s.selectedCanvasId)

  // Drag state
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null)
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; popupX: number; popupY: number } | null>(null)
  const isDraggingRef = useRef(false)
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // Clean up drag listeners on unmount
  useEffect(() => () => { dragCleanupRef.current?.() }, [])

  const filteredTodos = useMemo(() => {
    if (!popup) return []
    const { filter } = popup
    return todos.filter(todo => {
      if (todo.isCompleted) return false
      switch (filter.type) {
        case 'person': {
          const assigned = assignedPeopleMap.get(todo.id)
          return assigned?.some(p => p.id === filter.personId) ?? false
        }
        case 'org': {
          const assigned = assignedOrgsMap.get(todo.id)
          return assigned?.some(o => o.id === filter.orgId) ?? false
        }
      }
    }).sort(bySortOrder)
  }, [popup, todos, assignedPeopleMap, assignedOrgsMap])

  const pos = useMemo(() => {
    if (!popup) return { x: 0, y: 0, maxHeight: 600 }
    return computePosition(popup.x, popup.y)
  }, [popup])

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, popupX: pos.x, popupY: pos.y }
    isDraggingRef.current = false

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = ev.clientX - dragStartRef.current.mouseX
      const dy = ev.clientY - dragStartRef.current.mouseY
      if (!isDraggingRef.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      isDraggingRef.current = true
      setDragOffset({ dx, dy })
    }

    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      dragCleanupRef.current = null
    }

    const onMouseUp = (ev: MouseEvent) => {
      cleanup()

      if (isDraggingRef.current && activeView === AppView.Canvas && selectedCanvasId && popup) {
        // Convert screen position to flow coordinates
        const canvasEl = document.querySelector('.react-flow')
        const viewport = useSettingsStore.getState().canvasViewport
        if (canvasEl && viewport) {
          const rect = canvasEl.getBoundingClientRect()
          const flowX = (ev.clientX - rect.left - viewport.x) / viewport.zoom
          const flowY = (ev.clientY - rect.top - viewport.y) / viewport.zoom
          // Auto-create an unpinned ListDefinition scoped to this attribute
          // filter, then pin an inset referencing it. Users can later promote
          // the def to the dashboard or edit its predicate via the manager.
          void (async () => {
            const name = filterToListDefName(popup.filter)
            const predicate = filterToPredicate(popup.filter)
            const defId = await addListDef({
              name,
              pinnedToDashboard: false,
              membership: { kind: 'custom', predicate },
              sort: { kind: 'sort-order' },
              grouping: { kind: 'none' },
            })
            await addInset(defId, selectedCanvasId, flowX, flowY)
            hideFilteredList()
          })()
        }
      }

      dragStartRef.current = null
      isDraggingRef.current = false
      setDragOffset(null)
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [pos, activeView, selectedCanvasId, popup, addListDef, addInset, hideFilteredList])

  // Close on Escape
  useEffect(() => {
    if (!popup) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideFilteredList()
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [popup, hideFilteredList])

  // Reset drag state when popup changes
  useEffect(() => {
    setDragOffset(null)
    dragStartRef.current = null
    isDraggingRef.current = false
  }, [popup])

  if (!popup) return null

  const { filter } = popup
  const { label, icon } = getHeaderInfo(filter)
  const isOnCanvas = activeView === AppView.Canvas

  const displayX = dragOffset ? pos.x + dragOffset.dx : pos.x
  const displayY = dragOffset ? pos.y + dragOffset.dy : pos.y

  return createPortal(
    <>
      <div
        className={styles.backdrop}
        onClick={hideFilteredList}
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
      />
      <div
        className={`${styles.popup} ${dragOffset ? styles.dragging : ''}`}
        style={{
          position: 'fixed',
          left: displayX,
          top: displayY,
          maxHeight: dragOffset ? undefined : pos.maxHeight,
          zIndex: 9999,
        }}
      >
        <div
          className={`${styles.header} ${isOnCanvas ? styles.headerDraggable : ''}`}
          onMouseDown={isOnCanvas ? handleHeaderMouseDown : undefined}
        >
          <span className={styles.headerIcon}>{icon}</span>
          <span className={styles.headerLabel}>{label}</span>
          <span className={styles.headerCount}>{filteredTodos.length}</span>
          {isOnCanvas && <span className={styles.dragHint} title="Drag to pin on canvas">⊞</span>}
          <button className={styles.closeButton} onClick={hideFilteredList}>&times;</button>
        </div>
        <div
          className={styles.body}
        >
          {filteredTodos.length === 0 ? (
            <div className={styles.emptyMessage}>No tasks</div>
          ) : (
            filteredTodos.map(todo => (
              <TaskRow
                key={todo.id}
                todo={todo}
                assignedPeople={assignedPeopleMap.get(todo.id)}
                onOpenDetail={() => { hideFilteredList(); openEditPopup(todo.id) }}
              />
            ))
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
