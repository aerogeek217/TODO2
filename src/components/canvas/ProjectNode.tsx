import { useState, useRef, useEffect, useContext, useMemo, memo } from 'react'
import { createPortal } from 'react-dom'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useDroppable } from '@dnd-kit/core'
import type { Project, PersistedTodoItem, Person, Status } from '../../models'
import { SortableTaskList } from './SortableTaskList'
import { DragInsertContext } from './DragInsertContext'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useStatusStore } from '../../stores/status-store'
import { buildHierarchy } from '../../utils/hierarchy'
import { effectiveDate } from '../../utils/effective-date'
import { startOfToday } from '../../utils/date'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import { PlainTextExportPopup } from '../overlays/PlainTextExportPopup'
import styles from './ProjectNode.module.css'

type SortBy = 'name' | 'date' | 'created'

export function sortProjectTasks(todos: PersistedTodoItem[], sortBy: SortBy, asc: boolean): PersistedTodoItem[] {
  const today = startOfToday()
  const compareFn = (a: PersistedTodoItem, b: PersistedTodoItem): number => {
    const dir = asc ? 1 : -1
    switch (sortBy) {
      case 'name':
        return a.title.localeCompare(b.title) * dir
      case 'date': {
        const ae = effectiveDate(a, today)
        const be = effectiveDate(b, today)
        const aTime = ae ? ae.getTime() : Infinity
        const bTime = be ? be.getTime() : Infinity
        return (aTime - bTime) * dir
      }
      case 'created':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
    }
  }

  // buildHierarchy sorts both roots and children with the comparator (since
  // hierarchy.ts:62 propagates it), so children naturally stay grouped under
  // their parent and follow the same sort key.
  const hierarchy = buildHierarchy(todos, compareFn)
  const result: PersistedTodoItem[] = []
  for (const { parent, children } of hierarchy) {
    result.push(parent)
    result.push(...children)
  }
  return result
}

export interface ProjectNodeData {
  project: Project
  todos: PersistedTodoItem[]
  assignedPeopleMap: Map<number, Person[]>
  ghostTodoIds?: Set<number>
  onAddTask: (projectId: number, title: string) => void
  onInsertTask?: (title: string, projectId: number, beforeTodoId: number | null, parentId: number | undefined) => Promise<number>
  onDeleteProject: (projectId: number) => void
  onRenameProject: (projectId: number, name: string) => void
  onToggleCollapse: (projectId: number) => void
  onOpenDetail?: (todoId: number) => void
  onResizeProject?: (projectId: number, width: number) => void
  onResizeSnap?: (projectId: number, newWidth: number) => { width: number; lines: { orientation: 'horizontal' | 'vertical'; position: number; start: number; end: number }[] }
  onSetAlignmentLines?: (lines: { orientation: 'horizontal' | 'vertical'; position: number; start: number; end: number }[]) => void
  onSetColor?: (projectId: number, color: string | undefined) => void
  onBringToFront?: () => void
}

type ProjectNodeType = ProjectNodeData

function ProjectNodeInner({ data, selected }: NodeProps & { data: ProjectNodeType }) {
  const { project, todos, assignedPeopleMap, ghostTodoIds, onAddTask, onInsertTask, onDeleteProject, onRenameProject, onToggleCollapse, onOpenDetail, onResizeProject, onResizeSnap, onSetAlignmentLines, onSetColor, onBringToFront } = data
  const { getZoom } = useReactFlow()
  const statuses = useStatusStore((s) => s.statuses)
  const statusMap = useMemo(() => new Map(statuses.map(s => [s.id!, s as Status])), [statuses])
  const { dragExpandedProjectId } = useContext(DragInsertContext)
  const showBody = !project.isCollapsed || dragExpandedProjectId === project.id
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [showAddInput, setShowAddInput] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameText, setRenameText] = useState(project.name)
  const addInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameTimerRef = useRef<number | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [lastSort, setLastSort] = useState<{ by: SortBy; asc: boolean } | null>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  // Clean up resize listeners and rename timer on unmount
  useEffect(() => () => {
    resizeCleanupRef.current?.()
    if (renameTimerRef.current) clearTimeout(renameTimerRef.current)
  }, [])

  const handleSort = (sortBy: SortBy) => {
    setShowSortMenu(false)
    if (!project.id) return
    // Toggle direction if same sort clicked again
    const asc = lastSort && lastSort.by === sortBy ? !lastSort.asc : true
    setLastSort({ by: sortBy, asc })
    const sorted = sortProjectTasks(todos, sortBy, asc)
    const mutations = sorted.map((t, i) => ({ todoId: t.id, changes: { sortOrder: i + 1 } }))
    useTodoStore.getState().applyMutations(mutations)
  }

  // Close sort menu on outside click
  useEffect(() => {
    if (!showSortMenu) return
    const handler = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [showSortMenu])

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `project-drop-${project.id}`,
    data: { type: 'project', projectId: project.id },
  })

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenaming])

  const handleAddTask = () => {
    const title = newTaskTitle.trim()
    if (!title || !project.id) return
    onAddTask(project.id, title)
    setNewTaskTitle('')
    addInputRef.current?.focus()
  }

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddTask()
    if (e.key === 'Escape') {
      setNewTaskTitle('')
      setShowAddInput(false)
    }
    e.stopPropagation()
  }

  const handleAddBlur = () => {
    if (!newTaskTitle.trim()) {
      setShowAddInput(false)
    }
  }


  const handleConfirmRename = () => {
    if (renameText.trim() && project.id) {
      onRenameProject(project.id, renameText.trim())
    }
    setIsRenaming(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') handleConfirmRename()
    if (e.key === 'Escape') setIsRenaming(false)
  }

  const projectStyle: React.CSSProperties = {
    ...(project.width ? { width: project.width, minWidth: 200, maxWidth: 'none' } : {}),
    ...(project.color ? { borderColor: project.color, '--project-color': project.color } as React.CSSProperties : {}),
  }

  return (
    <div
      className={`${styles.project} ${isOver ? styles.dropTarget : ''} ${project.color ? styles.hasColor : ''} ${selected ? styles.selected : ''}`}
      style={projectStyle}
      onMouseDownCapture={onBringToFront}
      onClick={() => useUIStore.getState().clearSelection()}
    >
      <div className={styles.titleBar} onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!project.id) return
        const items: ContextMenuItem[] = [
          { label: 'Rename', action: () => { setRenameText(project.name); setIsRenaming(true) } },
          { label: project.isCollapsed ? 'Expand' : 'Collapse', action: () => onToggleCollapse(project.id!) },
          { label: 'Export as text', action: () => setShowExport(true) },
          { separator: true, label: '', action: () => {} },
          { label: 'Delete', action: () => onDeleteProject(project.id!), danger: true },
        ]
        setCtxMenu({ x: e.clientX, y: e.clientY, items })
      }}>
        <button
          className={`${styles.collapseButton} ${project.isCollapsed ? styles.collapsed : ''}`}
          onClick={() => project.id && onToggleCollapse(project.id)}
        >
          ▾
        </button>

        {isRenaming ? (
          <input
            ref={renameInputRef}
            className={`${styles.renameInput} nopan nodrag`}
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleConfirmRename}
          />
        ) : (
          <span
            className={styles.projectName}
            style={project.color ? { color: project.color } : undefined}
            onClick={(e) => {
              e.stopPropagation()
              if (selected) {
                renameTimerRef.current = window.setTimeout(() => {
                  setRenameText(project.name)
                  setIsRenaming(true)
                }, 250)
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (renameTimerRef.current) { clearTimeout(renameTimerRef.current); renameTimerRef.current = null }
              setRenameText(project.name)
              setIsRenaming(true)
            }}
          >
            {project.name}
          </span>
        )}

        {project.isCollapsed && (
          <span className={styles.taskCount}>{todos.length}</span>
        )}

        {todos.length > 1 && (
          <div className={styles.sortWrapper} ref={sortMenuRef}>
            <button
              className={`${styles.sortButton} nopan nodrag`}
              onClick={(e) => { e.stopPropagation(); setShowSortMenu(v => !v) }}
              title="Sort tasks"
            >
              {lastSort ? (lastSort.asc ? '↑' : '↓') : '↕'}
            </button>
            {showSortMenu && (
              <div className={styles.sortMenu}>
                {([['name', 'Name'], ['date', 'Date'], ['created', 'Created']] as const).map(([key, label]) => (
                  <button key={key} className={`${styles.sortOption} ${lastSort?.by === key ? styles.sortOptionActive : ''}`} onClick={(e) => { e.stopPropagation(); handleSort(key) }}>
                    {label}
                    {lastSort?.by === key && <span className={styles.sortArrow}>{lastSort.asc ? '↑' : '↓'}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {onSetColor && (
          <input
            type="color"
            className={`${styles.colorPicker} nopan nodrag`}
            value={project.color || '#a2cfcb'}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); project.id && onSetColor(project.id, e.target.value) }}
            onDoubleClick={(e) => { e.stopPropagation(); project.id && onSetColor(project.id, undefined) }}
            title="Set color (double-click to reset)"
          />
        )}

        <button
          className={styles.deleteProject}
          onClick={() => project.id && onDeleteProject(project.id)}
        >
          ×
        </button>
      </div>

      <div
        ref={setDropRef}
        className={`${showBody ? styles.nodeBody : styles.collapsedBody} nopan nodrag nowheel`}
      >
        {showBody && (
          <>
            <div className={styles.taskList}>
              <SortableTaskList
                projectId={project.id!}
                todos={todos}
                assignedPeopleMap={assignedPeopleMap}
                ghostTodoIds={ghostTodoIds}
                onOpenDetail={onOpenDetail}
                onInsertTask={onInsertTask ? (title, beforeId, parentId) => onInsertTask(title, project.id!, beforeId, parentId) : undefined}
              />
            </div>

            {showAddInput && (
              <div className={styles.addTaskRow}>
                <input
                  ref={addInputRef}
                  className={styles.addTaskInput}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={handleAddKeyDown}
                  onBlur={handleAddBlur}
                  placeholder="New task title..."
                />
              </div>
            )}
          </>
        )}
      </div>


      {/* Horizontal resize handle */}
      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const zoom = getZoom()
          const projectEl = (e.currentTarget as HTMLElement).closest('.' + styles.project) as HTMLElement | null
          const startW = projectEl?.getBoundingClientRect().width ?? 260

          const onMouseMove = (ev: MouseEvent) => {
            let newW = Math.max(200, startW / zoom + (ev.clientX - startX) / zoom)
            if (project.id && onResizeSnap) {
              const snap = onResizeSnap(project.id, newW)
              newW = snap.width
              onSetAlignmentLines?.(snap.lines)
            }
            if (projectEl) {
              projectEl.style.width = `${newW}px`
              projectEl.style.minWidth = '200px'
              projectEl.style.maxWidth = 'none'
            }
          }

          const onMouseUp = (ev: MouseEvent) => {
            let newW = Math.max(200, startW / zoom + (ev.clientX - startX) / zoom)
            if (project.id && onResizeSnap) {
              newW = onResizeSnap(project.id, newW).width
            }
            onSetAlignmentLines?.([])
            if (project.id && onResizeProject) onResizeProject(project.id, Math.round(newW))
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

      {ctxMenu && createPortal(
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />,
        document.body,
      )}

      {showExport && createPortal(
        <PlainTextExportPopup
          sections={[{ key: `project-${project.id}`, label: project.name, todos }]}
          assignedPeopleMap={assignedPeopleMap}
          statusMap={statusMap}
          onClose={() => setShowExport(false)}
        />,
        document.body,
      )}
    </div>
  )
}

export const ProjectNode = memo(ProjectNodeInner)
