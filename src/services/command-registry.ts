import type { Person, PersistedTodoItem, Status } from '../models'
import { startOfToday } from '../utils/date'
import { byName } from '../utils/sort-order'
import { useUndoStore } from '../stores/undo-store'
import { useUIStore } from '../stores/ui-store'
import { useTodoStore } from '../stores/todo-store'
import { useSettingsStore } from '../stores/settings-store'
import { shortcutLabel } from '../utils/shortcut-bindings'
import type { ShortcutId, ShortcutOverrides } from '../models/keyboard-shortcut'

/** `task` = task actions (New Task, Undo …); `search-results` = tasks found by the palette's search. */
export type CommandCategory = 'navigation' | 'task' | 'bulk' | 'filter' | 'email' | 'search-results'

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
  /**
   * Emails one person their check-in at once (`checkin-email/person-checkin`
   * `sendPersonCheckin`). Runs inside the command's key press / click: the
   * clipboard write needs that gesture.
   */
  sendPersonCheckin?: (personId: number) => void
  /** Opens the check-in reply import dialog. */
  openCheckinImport?: () => void
  /** People, for the per-person check-in commands. */
  getPeople?: () => readonly Person[]
  /** Open tasks assigned per person id (people with none may be absent). */
  getOpenTaskCounts?: () => ReadonlyMap<number, number>
}

const openTasksLabel = (n: number) => `${n} open ${n === 1 ? 'task' : 'tasks'}`

/**
 * `Email check-in: <person>` for each person with at least one open task, by
 * name (an email address isn't needed: the recipient can be added in the mail
 * app); the hint counts their open tasks. Running one sends that person's
 * check-in at once.
 */
function personCheckinCommands(ctx: CommandContext, send: (personId: number) => void): Command[] {
  const counts = ctx.getOpenTaskCounts?.() ?? new Map<number, number>()
  return (ctx.getPeople?.() ?? [])
    .flatMap((p) => {
      const id = p.id
      const n = id != null ? counts.get(id) ?? 0 : 0
      if (id == null || n === 0) return []
      return [{ id, name: p.name, n }]
    })
    .sort(byName)
    .map(({ id, name, n }): Command => ({
      id: `email-checkin-${id}`,
      name: `Email check-in: ${name}`,
      hint: openTasksLabel(n),
      category: 'email',
      action: () => send(id),
    }))
}

/** The palette's commands; key hints show the live keys (`overrides`: the user's shortcut changes). */
export function createCommands(
  ctx: CommandContext,
  overrides: ShortcutOverrides = useSettingsStore.getState().shortcutOverrides,
): Command[] {
  const keys = (id: ShortcutId) => shortcutLabel(id, overrides)
  const commands: Command[] = [
    // Navigation
    { id: 'open-settings', name: 'Open Settings', shortcut: keys('open-settings'), category: 'navigation', action: ctx.openSettings },
    { id: 'focus-filter', name: 'Focus Filters', shortcut: keys('focus-filters'), category: 'navigation', action: () => {
      const filterRow = document.querySelector('[data-filter-row]')
      const firstBtn = filterRow?.querySelector('button') as HTMLElement | null
      firstBtn?.focus()
    }},
    { id: 'focus-search', name: 'Focus Search', shortcut: keys('focus-search'), category: 'navigation', action: () => {
      const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement | null
      if (searchInput) { searchInput.focus(); searchInput.select() }
    }},
    ...(ctx.openShortcutsModal ? [{ id: 'keyboard-shortcuts', name: 'Keyboard Shortcuts', shortcut: keys('show-shortcuts'), category: 'navigation' as CommandCategory, action: ctx.openShortcutsModal }] : []),

    // Task actions
    { id: 'new-task', name: 'New Task', shortcut: keys('quick-add'), category: 'task', action: ctx.openQuickAdd },
    { id: 'undo', name: 'Undo', shortcut: keys('undo'), category: 'task', action: () => { void useUndoStore.getState().undo() } },
    { id: 'redo', name: 'Redo', shortcut: keys('redo'), category: 'task', action: () => { void useUndoStore.getState().redo() } },
    { id: 'select-all', name: 'Select All Tasks', shortcut: keys('select-all'), category: 'task', action: () => {
      const rows = Array.from(document.querySelectorAll('[data-todo-id]'))
      if (rows.length > 0) {
        const todoIds = rows.map(el => Number(el.getAttribute('data-todo-id')))
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
  if (ctx.sendPersonCheckin) commands.push(...personCheckinCommands(ctx, ctx.sendPersonCheckin))

  // Bulk actions — only when tasks are selected
  if (ctx.selectionCount === 1) {
    commands.push({
      id: 'task-duplicate', name: 'Duplicate Task', category: 'task',
      action: async () => {
        const ids = ctx.getSelectedIds()
        const onlyId = ids[0]
        if (ids.length === 1 && onlyId != null) {
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
        category: 'search-results',
        action: () => ctx.focusTask(todo.id),
      })
    }
  }

  return results
}
