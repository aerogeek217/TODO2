import type { PersistedTodoItem, Project, Status } from '../models'
import { Priority } from '../models'
import { startOfToday } from '../utils/date'

export type CommandCategory = 'navigation' | 'task' | 'bulk' | 'filter' | 'tasks' | 'projects'

export interface Command {
  id: string
  name: string
  shortcut?: string
  category: CommandCategory
  action: () => void
}

export interface CommandContext {
  navigateTo: (path: string) => void
  openQuickAdd: () => void
  /** Number of currently selected tasks */
  selectionCount: number
  /** Bulk actions on selected tasks */
  bulkSetCompleted: (ids: number[], completed: boolean) => Promise<void>
  bulkSetStarred: (ids: number[], starred: boolean) => Promise<void>
  bulkSetPriority: (ids: number[], priority: Priority) => Promise<void>
  bulkSetStatus: (ids: number[], statusId: number | undefined) => Promise<void>
  bulkRemove: (ids: number[]) => Promise<void>
  getSelectedIds: () => number[]
  /** Filter actions */
  toggleStarredOnly: () => void
  toggleHardDeadlineOnly: () => void
  setPriorities: (p: Set<Priority> | null) => void
  getPriorities: () => Set<Priority> | null
  clearAllFilters: () => void
  toggleShowCompleted: () => void
  setDateRange: (start: Date | null, end: Date | null) => void
  /** Lazy todo getter (for task search — only called when palette has a query) */
  getTodos: () => PersistedTodoItem[]
  /** Lazy project getter (for project navigation — only called when palette has a query) */
  getProjects: () => Project[]
  /** Navigate to a task on canvas */
  focusTask: (todoId: number) => void
  /** Navigate to a project on canvas */
  focusProject: (projectId: number) => void
  /** Fit all nodes into view */
  fitView?: () => void
  /** Canvas-only: create sticky note */
  createStickyNote?: () => void
  /** Canvas-only: toggle project navigator */
  toggleProjectNavigator?: () => void
  /** Open keyboard shortcuts modal */
  openShortcutsModal?: () => void
  /** Statuses for bulk commands */
  getStatuses?: () => Status[]
}

export function createCommands(ctx: CommandContext): Command[] {
  const commands: Command[] = [
    // Navigation
    { id: 'nav-canvas', name: 'Go to Canvas', shortcut: 'G then C', category: 'navigation', action: () => ctx.navigateTo('/') },
    { id: 'nav-list', name: 'Go to List', shortcut: 'G then L', category: 'navigation', action: () => ctx.navigateTo('/list') },
    { id: 'nav-calendar', name: 'Go to Calendar', shortcut: 'G then A', category: 'navigation', action: () => ctx.navigateTo('/calendar') },
    { id: 'nav-settings', name: 'Go to Settings', shortcut: 'G then S', category: 'navigation', action: () => ctx.navigateTo('/settings') },
    { id: 'focus-filter', name: 'Focus Filters', shortcut: 'F', category: 'navigation', action: () => {
      const filterRow = document.querySelector('[data-filter-row]')
      const firstBtn = filterRow?.querySelector('button') as HTMLElement | null
      firstBtn?.focus()
    }},
    { id: 'focus-search', name: 'Focus Search', shortcut: 'Ctrl+F', category: 'navigation', action: () => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
      if (searchInput) { searchInput.focus(); searchInput.select() }
    }},
    ...(ctx.fitView ? [{ id: 'fit-view', name: 'Fit All to View', shortcut: 'Ctrl+0', category: 'navigation' as CommandCategory, action: ctx.fitView }] : []),
    ...(ctx.toggleProjectNavigator ? [{ id: 'toggle-project-nav', name: 'Toggle Project Navigator', shortcut: 'P', category: 'navigation' as CommandCategory, action: ctx.toggleProjectNavigator }] : []),
    ...(ctx.openShortcutsModal ? [{ id: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', shortcut: '?', category: 'navigation' as CommandCategory, action: ctx.openShortcutsModal }] : []),

    // Task actions
    { id: 'new-task', name: 'New Task', shortcut: 'Ctrl+Space', category: 'task', action: ctx.openQuickAdd },
    ...(ctx.createStickyNote ? [{ id: 'new-sticky-note', name: 'New Sticky Note', shortcut: 'N', category: 'task' as CommandCategory, action: ctx.createStickyNote }] : []),
    { id: 'undo', name: 'Undo', shortcut: 'Ctrl+Z', category: 'task', action: async () => {
      const { useUndoStore } = await import('../stores/undo-store')
      useUndoStore.getState().undo()
    }},
    { id: 'redo', name: 'Redo', shortcut: 'Ctrl+Shift+Z', category: 'task', action: async () => {
      const { useUndoStore } = await import('../stores/undo-store')
      useUndoStore.getState().redo()
    }},
    { id: 'select-all', name: 'Select All Tasks', shortcut: 'Ctrl+A', category: 'task', action: async () => {
      const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
      if (rows.length > 0) {
        const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
        const { useUIStore } = await import('../stores/ui-store')
        useUIStore.getState().selectAll(todoIds)
      }
    }},

    // Filter presets
    { id: 'filter-starred', name: 'Toggle Follow Up Only', category: 'filter', action: ctx.toggleStarredOnly },
    { id: 'filter-high', name: 'Toggle High Priority', category: 'filter', action: () => {
      ctx.setPriorities(ctx.getPriorities()?.has(Priority.High) && ctx.getPriorities()?.size === 1 ? null : new Set([Priority.High]))
    }},
    { id: 'filter-hard-deadline', name: 'Toggle Hard Deadlines Only', category: 'filter', action: ctx.toggleHardDeadlineOnly },
    { id: 'filter-show-completed', name: 'Toggle Show Completed', category: 'filter', action: ctx.toggleShowCompleted },
    { id: 'filter-clear', name: 'Clear All Filters', category: 'filter', action: ctx.clearAllFilters },
    { id: 'filter-overdue', name: 'Show Overdue Tasks', category: 'filter', action: () => {
      ctx.clearAllFilters()
      const yesterday = new Date(startOfToday().getTime() - 1)
      ctx.setDateRange(null, yesterday)
    }},
  ]

  // Bulk actions — only when tasks are selected
  if (ctx.selectionCount === 1) {
    commands.push({
      id: 'task-duplicate', name: 'Duplicate Task', category: 'task',
      action: async () => {
        const ids = ctx.getSelectedIds()
        if (ids.length === 1) {
          const { useTodoStore } = await import('../stores/todo-store')
          await useTodoStore.getState().duplicate(ids[0])
        }
      },
    })
  }
  if (ctx.selectionCount > 0) {
    const label = ctx.selectionCount === 1 ? '1 Task' : `${ctx.selectionCount} Tasks`
    commands.push(
      { id: 'bulk-complete', name: `Complete ${label}`, category: 'bulk', action: () => ctx.bulkSetCompleted(ctx.getSelectedIds(), true) },
      { id: 'bulk-uncomplete', name: `Uncomplete ${label}`, category: 'bulk', action: () => ctx.bulkSetCompleted(ctx.getSelectedIds(), false) },
      { id: 'bulk-star', name: `Follow Up ${label}`, category: 'bulk', action: () => ctx.bulkSetStarred(ctx.getSelectedIds(), true) },
      { id: 'bulk-unstar', name: `Remove Follow Up ${label}`, category: 'bulk', action: () => ctx.bulkSetStarred(ctx.getSelectedIds(), false) },
      { id: 'bulk-priority-high', name: `Set ${label} Priority: High`, category: 'bulk', action: () => ctx.bulkSetPriority(ctx.getSelectedIds(), Priority.High) },
      { id: 'bulk-priority-medium', name: `Set ${label} Priority: Medium`, category: 'bulk', action: () => ctx.bulkSetPriority(ctx.getSelectedIds(), Priority.Medium) },
      { id: 'bulk-priority-normal', name: `Set ${label} Priority: Normal`, category: 'bulk', action: () => ctx.bulkSetPriority(ctx.getSelectedIds(), Priority.Normal) },
    )
    // Bulk status commands
    const statuses = ctx.getStatuses?.() ?? []
    for (const status of statuses) {
      commands.push({
        id: `bulk-status-${status.id}`,
        name: `Set ${label} Status: ${status.name}`,
        category: 'bulk',
        action: () => ctx.bulkSetStatus(ctx.getSelectedIds(), status.id!),
      })
    }
    if (statuses.length > 0) {
      commands.push({
        id: 'bulk-status-clear',
        name: `Clear Status from ${label}`,
        category: 'bulk',
        action: () => ctx.bulkSetStatus(ctx.getSelectedIds(), undefined),
      })
    }
    commands.push(
      { id: 'bulk-delete', name: `Delete ${label}`, category: 'bulk', action: () => ctx.bulkRemove(ctx.getSelectedIds()) },
      { id: 'bulk-cut', name: `Cut ${label}`, shortcut: 'Ctrl+X', category: 'bulk', action: async () => {
        const ids = ctx.getSelectedIds()
        if (ids.length > 0) {
          const { useTodoStore } = await import('../stores/todo-store')
          const { useUIStore } = await import('../stores/ui-store')
          const todos = useTodoStore.getState().todos
          const first = todos.find(t => ids.includes(t.id))
          useUIStore.getState().cutTasks(ids, first?.projectId ?? null)
        }
      }},
    )
  }

  return commands
}

/**
 * Filter-first dynamic command search — only creates Command objects for
 * todos/projects whose names match the query. Called lazily by the command
 * palette when the user types a search string.
 */
export function searchDynamicCommands(query: string, ctx: CommandContext): Command[] {
  if (!query) return []
  const q = query.toLowerCase()
  const results: Command[] = []

  for (const project of ctx.getProjects()) {
    if (project.name.toLowerCase().includes(q)) {
      results.push({
        id: `project-${project.id}`,
        name: project.name,
        category: 'projects',
        action: () => ctx.focusProject(project.id!),
      })
    }
  }

  for (const todo of ctx.getTodos()) {
    if (todo.title.toLowerCase().includes(q)) {
      results.push({
        id: `task-${todo.id}`,
        name: todo.title,
        category: 'tasks',
        action: () => ctx.focusTask(todo.id),
      })
    }
  }

  return results
}
