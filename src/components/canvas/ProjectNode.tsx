import { useState, useRef, useEffect, useContext, useMemo, memo } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import { useDroppable } from '@dnd-kit/core'
import type { Project, PersistedTodoItem, Person, ProjectGroupBy, Status, TodoSortBy } from '../../models'
import { SortableTaskList } from './SortableTaskList'
import { DragInsertContext } from './DragInsertContext'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { useProjectStore } from '../../stores/project-store'
import { useStatusStore } from '../../stores/status-store'
import { effectiveDate, type WeekStart } from '../../utils/effective-date'
import { startOfToday } from '../../utils/date'
import { useSettingsStore } from '../../stores/settings-store'
import { CanvasContextMenu, type ContextMenuItem } from '../overlays/CanvasContextMenu'
import { copyTasksRich } from '../../services/task-copy'
import { TASK_DROP_KIND, projectDropId } from '../../utils/task-dnd'
import { GROUP_OPTIONS } from '../../utils/task-grouping'
import { SortGroupToolbar, type SortGroupOption } from '../shared/SortGroupToolbar'
import styles from './ProjectNode.module.css'

export { GROUP_OPTIONS }

type ProjectSortBy = Extract<TodoSortBy, 'name' | 'date' | 'created'>

const PROJECT_NULL_GROUP = 'none' as const
type ProjectGroupKey = ProjectGroupBy | typeof PROJECT_NULL_GROUP

const PROJECT_SORT_OPTIONS: readonly SortGroupOption<ProjectSortBy>[] = [
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Effective Date' },
  { value: 'created', label: 'Created' },
]

const PROJECT_GROUP_OPTIONS: readonly SortGroupOption<ProjectGroupKey>[] =
  GROUP_OPTIONS.map((o) => ({
    value: o.value ?? PROJECT_NULL_GROUP,
    label: o.label,
  }))

export function sortProjectTasks(todos: PersistedTodoItem[], sortBy: ProjectSortBy, asc: boolean, weekStartsOn: WeekStart): PersistedTodoItem[] {
  const today = startOfToday()
  const compareFn = (a: PersistedTodoItem, b: PersistedTodoItem): number => {
    const dir = asc ? 1 : -1
    switch (sortBy) {
      case 'name':
        return a.title.localeCompare(b.title) * dir
      case 'date': {
        const ae = effectiveDate(a, today, weekStartsOn)
        const be = effectiveDate(b, today, weekStartsOn)
        const aTime = ae ? ae.getTime() : Infinity
        const bTime = be ? be.getTime() : Infinity
        return (aTime - bTime) * dir
      }
      case 'created':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
    }
  }

  return [...todos].sort(compareFn)
}

export interface ProjectNodeData {
  project: Project
  todos: PersistedTodoItem[]
  assignedPeopleMap: Map<number, Person[]>
  ghostTodoIds?: Set<number>
  onAddTask: (projectId: number, title: string) => void
  onInsertTask?: (title: string, projectId: number, beforeTodoId: number | null) => Promise<number>
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
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
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
  const [lastSort, setLastSort] = useState<{ by: ProjectSortBy; asc: boolean } | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  // Clean up resize listeners and rename timer on unmount
  useEffect(() => () => {
    resizeCleanupRef.current?.()
    if (renameTimerRef.current) clearTimeout(renameTimerRef.current)
  }, [])

  const handleSort = (sortBy: ProjectSortBy) => {
    if (!project.id) return
    // Toggle direction if same sort clicked again
    const asc = lastSort && lastSort.by === sortBy ? !lastSort.asc : true
    setLastSort({ by: sortBy, asc })
    const sorted = sortProjectTasks(todos, sortBy, asc, weekStartsOn)
    const mutations = sorted.map((t, i) => ({ todoId: t.id, changes: { sortOrder: i + 1 } }))
    useTodoStore.getState().applyMutations(mutations)
  }

  const handleGroup = (groupBy: ProjectGroupKey) => {
    if (!project.id) return
    const next = groupBy === PROJECT_NULL_GROUP ? null : groupBy
    void useProjectStore.getState().updateProjectGrouping(project.id, next)
  }

  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: projectDropId(project.id!),
    data: { type: TASK_DROP_KIND.project, projectId: project.id },
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
          { separator: true, label: '', action: () => {} },
          { label: 'Delete', action: () => onDeleteProject(project.id!), danger: true },
        ]
        setCtxMenu({ x: e.clientX, y: e.clientY, items })
      }}>
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

        <SortGroupToolbar<ProjectSortBy, ProjectGroupKey>
          density="compact"
          className={styles.toolbar}
          showSort={todos.length > 1}
          sortBy={lastSort?.by ?? 'name'}
          sortAsc={lastSort?.asc}
          groupBy={(project.groupBy ?? PROJECT_NULL_GROUP) as ProjectGroupKey}
          sortOptions={PROJECT_SORT_OPTIONS}
          groupOptions={PROJECT_GROUP_OPTIONS}
          onSortChange={handleSort}
          onGroupChange={handleGroup}
        />

        <button
          className={`${styles.exportButton} nopan nodrag`}
          onClick={(e) => {
            e.stopPropagation()
            void copyTasksRich(
              [{ todos }],
              { assignedPeopleMap, statusMap },
            )
          }}
          title="Copy tasks"
        >
          ⧉
        </button>

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
                groupBy={project.groupBy ?? null}
                assignedPeopleMap={assignedPeopleMap}
                ghostTodoIds={ghostTodoIds}
                onOpenDetail={onOpenDetail}
                onInsertTask={onInsertTask ? (title, beforeId) => onInsertTask(title, project.id!, beforeId) : undefined}
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

      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}

export const ProjectNode = memo(ProjectNodeInner)
