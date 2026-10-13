import type { Person, PersistedTodoItem, Status } from '../models'
import { startOfToday } from '../utils/date'
import { formatShortcut } from '../utils/platform'
import { isValidEmail } from '../utils/person'

export type CommandCategory = 'navigation' | 'task' | 'bulk' | 'filter' | 'email' | 'tasks'

export interface Command {
  id: string
  name: string
  shortcut?: string
  /** Muted text on the right of the row (e.g. `4 open tasks`). */
  hint?: string
  category: CommandCategory
  action: () => void
}

export interface CommandContext {
  /** Opens the Settings modal. */
  openSettings: () => void
  openQuickAdd: () => void
  /** Number of currently selected tasks */
  selectionCount: number
  /** Bulk actions on selected tasks */
  bulkSetCompleted: (ids: number[], completed: boolean) => Promise<void>
  bulkSetStatus: (ids: number[], statusId: number | undefined) => Promise<void>
  bulkRemove: (ids: number[]) => Promise<void>
  getSelectedIds: () => number[]
  /** Filter actions */
  clearAllFilters: () => void
  setShowCompleted: (show: boolean) => void
  getShowCompleted: () => boolean
  setDateRange: (start: Date | null, end: Date | null) => void
  /** Lazy todo getter (for task search — only called when palette has a query) */
  getTodos: () => PersistedTodoItem[]
  /** Open a task (from a palette task search hit) */
  focusTask: (todoId: number) => void
  /** Open keyboard shortcuts modal */
  openShortcutsModal?: () => void
  /** Statuses for bulk commands */
  getStatuses?: () => Status[]
  /** Opens the email check-in dialog with `personIds` ticked (none = choose people there). */
  openCheckinDialog?: (personIds?: number[]) => void
  /** Opens the check-in reply import dialog. */
  openCheckinImport?: () => void
  /** People, for the per-person check-in commands. */
  getPeople?: () => readonly Person[]
  /** Open tasks assigned per person id (people with none may be absent). */
  getOpenTaskCounts?: () => ReadonlyMap<number, number>
}

const openTasksLabel = (n: number) => `${n} open ${n === 1 ? 'task' : 'tasks'}`

/**
 * `Email check-in: <person>` for each person with a valid email address and at
 * least one open task, by name; the hint counts their open tasks.
 */
function personCheckinCommands(ctx: CommandContext, open: (personIds: number[]) => void): Command[] {
  const counts = ctx.getOpenTaskCounts?.() ?? new Map<number, number>()
  return (ctx.getPeople?.() ?? [])
    .flatMap((p) => {
      const id = p.id
      const n = id != null ? counts.get(id) ?? 0 : 0
      if (id == null || n === 0 || !isValidEmail(p.email ?? '')) return []
      return [{ id, name: p.name, n }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name, n }): Command => ({
      id: `email-checkin-${id}`,
      name: `Email check-in: ${name}`,
      hint: openTasksLabel(n),
      category: 'email',
      action: () => open([id]),
    }))
}

export function createCommands(ctx: CommandContext): Command[] {
  const cmdF = formatShortcut('Mod-F')
  const cmdSpace = formatShortcut('Mod-Space')
  const cmdZ = formatShortcut('Mod-Z')
  const cmdShiftZ = formatShortcut('Mod-Shift-Z')
  const cmdA = formatShortcut('Mod-A')
  const commands: Command[] = [
    // Navigation
    { id: 'open-settings', name: 'Open Settings', shortcut: 'G then S', category: 'navigation', action: ctx.openSettings },
    { id: 'focus-filter', name: 'Focus Filters', shortcut: 'F', category: 'navigation', action: () => {
      const filterRow = document.querySelector('[data-filter-row]')
      const firstBtn = filterRow?.querySelector('button') as HTMLElement | null
      firstBtn?.focus()
    }},
    { id: 'focus-search', name: 'Focus Search', shortcut: cmdF, category: 'navigation', action: () => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
      if (searchInput) { searchInput.focus(); searchInput.select() }
    }},
    ...(ctx.openShortcutsModal ? [{ id: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', shortcut: '?', category: 'navigation' as CommandCategory, action: ctx.openShortcutsModal }] : []),

    // Task actions
    { id: 'new-task', name: 'New Task', shortcut: cmdSpace, category: 'task', action: ctx.openQuickAdd },
    { id: 'undo', name: 'Undo', shortcut: cmdZ, category: 'task', action: async () => {
      const { useUndoStore } = await import('../stores/undo-store')
      useUndoStore.getState().undo()
    }},
    { id: 'redo', name: 'Redo', shortcut: cmdShiftZ, category: 'task', action: async () => {
      const { useUndoStore } = await import('../stores/undo-store')
      useUndoStore.getState().redo()
    }},
    { id: 'select-all', name: 'Select All Tasks', shortcut: cmdA, category: 'task', action: async () => {
      const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
      if (rows.length > 0) {
        const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
        const { useUIStore } = await import('../stores/ui-store')
        useUIStore.getState().selectAll(todoIds)
      }
    }},

    // Filter presets
    { id: 'filter-show-completed', name: 'Toggle Show Completed', category: 'filter', action: () => ctx.setShowCompleted(!ctx.getShowCompleted()) },
    { id: 'filter-clear', name: 'Clear All Filters', category: 'filter', action: ctx.clearAllFilters },
    { id: 'filter-overdue', name: 'Show Overdue Tasks', category: 'filter', action: () => {
      ctx.clearAllFilters()
      const yesterday = new Date(startOfToday().getTime() - 1)
      ctx.setDateRange(null, yesterday)
    }},
  ]

  // Email
  const openCheckinDialog = ctx.openCheckinDialog
  if (openCheckinDialog) {
    commands.push({ id: 'email-checkins', name: 'Email task check-ins…', hint: 'choose people', category: 'email', action: () => openCheckinDialog() })
  }
  if (ctx.openCheckinImport) {
    commands.push({ id: 'email-import-reply', name: 'Import check-in reply…', category: 'email', action: ctx.openCheckinImport })
  }
  if (openCheckinDialog) commands.push(...personCheckinCommands(ctx, openCheckinDialog))

  // Bulk actions — only when tasks are selected
  if (ctx.selectionCount === 1) {
    commands.push({
      id: 'task-duplicate', name: 'Duplicate Task', category: 'task',
      action: async () => {
        const ids = ctx.getSelectedIds()
        const onlyId = ids[0]
        if (ids.length === 1 && onlyId != null) {
          const { useTodoStore } = await import('../stores/todo-store')
          await useTodoStore.getState().duplicate(onlyId)
        }
      },
    })
  }
  if (ctx.selectionCount > 0) {
    const label = ctx.selectionCount === 1 ? '1 Task' : `${ctx.selectionCount} Tasks`
    commands.push(
      { id: 'bulk-complete', name: `Complete ${label}`, category: 'bulk', action: () => ctx.bulkSetCompleted(ctx.getSelectedIds(), true) },
      { id: 'bulk-uncomplete', name: `Uncomplete ${label}`, category: 'bulk', action: () => ctx.bulkSetCompleted(ctx.getSelectedIds(), false) },
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
    )
  }

  return commands
}

/**
 * Filter-first dynamic command search — only creates Command objects for
 * todos whose titles match the query. Called lazily by the command
 * palette when the user types a search string.
 */
export function searchDynamicCommands(query: string, ctx: CommandContext): Command[] {
  if (!query) return []
  const q = query.toLowerCase()
  const results: Command[] = []

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
