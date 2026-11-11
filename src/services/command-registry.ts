import type { Person, PersistedTodoItem, Status } from '../models'
import { startOfToday } from '../utils/date'
import { byName } from '../utils/sort-order'
import { useTodoStore } from '../stores/todo-store'
import { useSettingsStore } from '../stores/settings-store'
import { shortcutLabel } from '../utils/shortcut-bindings'
import type { ShortcutId, ShortcutOverrides } from '../models/keyboard-shortcut'
import { runShortcutCommand, type ShortcutCallbacks } from './keyboard-shortcuts'
import { copySelectedTasks } from './task-copy'
import { listTabZoom, stepListTabZoom, zoomTargetTab } from './list-zoom'
import { LIST_ZOOM_LABELS, stepListZoom } from '../utils/list-zoom'
import { listReviewCount, personReviewFilter, reviewTargetTabId } from './review'
import { jumpToReview, reviewJumpAvailable } from './review-jump'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useUIStore, type LayoutRequest } from '../stores/ui-store'
import { lensActions } from '../stores/lens-actions'
import type { ThemeMode } from '../stores/settings-store'
import { findLens, type Lens } from '../utils/lens'
import { WIDGET_KIND_GROUPS, WIDGET_KIND_SPECS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../models/workspace-layout'

/**
 * `task` = task actions (New Task, Undo …); `layout` = the layouts and what
 * goes in them (Go to Layout ›, Add Widget ›); `search-results` = tasks found
 * by the palette's search.
 */
export type CommandCategory = 'navigation' | 'layout' | 'task' | 'bulk' | 'filter' | 'email' | 'search-results'

export interface Command {
  id: string
  name: string
  shortcut?: string
  /** Muted text on the right of the row (e.g. `4 open tasks`). */
  hint?: string
  category: CommandCategory
  /** What a leaf does (the palette then closes). A step command's is never run: the palette opens its `step`. */
  action: () => void
  /**
   * A second step (`Go to Layout ›`): choosing the command opens these in the
   * same palette, under a breadcrumb of its name; each is a leaf. The search
   * at the top level reaches them too (`Go to Layout › Planning`).
   */
  step?: readonly Command[]
  /** Inside a step: the heading it sits under (Add Widget ›'s Tasks / Insights); none, no heading. */
  group?: string
  /** The one in use (the open layout, the picked lens, the theme): marked in its row. */
  current?: boolean
}

/** A command that opens `step` (its own `action` is never run). */
function stepCommand(id: string, name: string, category: CommandCategory, step: readonly Command[]): Command {
  return { id, name, category, step, action: () => {} }
}

export interface CommandContext {
  /**
   * What the shortcut handlers the palette runs may call (Settings, the
   * shortcuts modal): the commands that have a binding run its handler.
   */
  shortcuts: ShortcutCallbacks
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
  /** Opens (or focuses) the top bar's panel of the tasks the screen filter matches (its tray edits that filter). */
  showScreenTasks?: () => void
  /** How many tasks that panel would list (open ones, completed too under Show completed). */
  getScreenTaskCount?: () => number
  /** Lazy todo getter (for task search — only called when palette has a query) */
  getTodos: () => PersistedTodoItem[]
  /** Open a task (from a palette task search hit) */
  focusTask: (todoId: number) => void
  /** Statuses for bulk commands */
  getStatuses?: () => Status[]
  /** Opens the email check-in dialog with `personIds` ticked (none = choose people there). */
  openCheckinDialog?: (personIds?: number[]) => void
  /** Opens the check-in reply import dialog. */
  openCheckinImport?: () => void
  /** People, for Review With ›. */
  getPeople?: () => readonly Person[]
  /** Open tasks assigned per person id (people with none may be absent). */
  getOpenTaskCounts?: () => ReadonlyMap<number, number>
  /**
   * Adds a widget of `kind` to the open layout (Add Widget ›): the Where
   * picker on the cell last used, the kind chosen; the empty layout's way
   * with no cell. Absent: no Add Widget ›.
   */
  addWidget?: (kind: WidgetKind) => void
  /** The layouts, for Go to Layout › and the layout commands; null (or absent) while no layout is open. */
  getLayouts?: () => LayoutChoices | null
  /** The lenses and the top bar's pick, for Lens ›. */
  getLenses?: () => { lenses: readonly Lens[]; activeLensId: string | null }
  /** The theme setting, for Theme ›. */
  getThemeMode?: () => ThemeMode
}

/** The layouts as the palette offers them: by name in their order, the open one, and whether it is stored (it can own lists). */
export interface LayoutChoices {
  layouts: readonly { id: number; name: string }[]
  activeLayoutId: number | null
  stored: boolean
}

const openTasksLabel = (n: number) => `${n} open ${n === 1 ? 'task' : 'tasks'}`
const tasksLabel = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

/** The people with at least one open task, by name, with how many. */
function peopleWithOpenTasks(ctx: CommandContext): { id: number; name: string; n: number }[] {
  const counts = ctx.getOpenTaskCounts?.() ?? new Map<number, number>()
  return (ctx.getPeople?.() ?? [])
    .flatMap((p) => {
      const id = p.id
      const n = id != null ? counts.get(id) ?? 0 : 0
      if (id == null || n === 0) return []
      return [{ id, name: p.name, n }]
    })
    .sort(byName)
}

/**
 * Review With › each person with open tasks (their count the hint): a jump
 * to a Review widget with `@<name>`, as the person menu's Review with X
 * (`services/review-jump`). None while no layout has a Review widget.
 */
function reviewWithCommands(ctx: CommandContext): Command[] {
  if (!reviewJumpAvailable()) return []
  const people = peopleWithOpenTasks(ctx).map(({ id, name, n }): Command => ({
    id: `review-with-${id}`,
    name,
    hint: openTasksLabel(n),
    category: 'task',
    action: () => { void jumpToReview(personReviewFilter({ id })) },
  }))
  return people.length > 0 ? [stepCommand('review-with', 'Review With', 'task', people)] : []
}

/**
 * The layouts' commands (none before the workspace has a layout open): Go
 * to Layout › each layout (the open one marked; a pick switches as its tab
 * does — `LayoutControls` runs it, `ui-store.requestLayout`), Add Widget ›
 * each kind by group, Tasks then Insights, as the Add widget menu lists
 * them (a list only once the layout is stored: it owns its lists), and New
 * Layout… / Duplicate Layout… (their name dialogs).
 */
function layoutCommands(ctx: CommandContext): Command[] {
  const choices = ctx.getLayouts?.()
  if (!choices) return []
  const { layouts, activeLayoutId, stored } = choices
  const request = (r: LayoutRequest) => useUIStore.getState().requestLayout(r)
  const commands: Command[] = [
    stepCommand('go-to-layout', 'Go to Layout', 'layout', layouts.map((l): Command => ({
      id: `go-to-layout-${l.id}`,
      name: l.name,
      category: 'layout',
      ...(l.id === activeLayoutId ? { current: true } : {}),
      action: () => request({ kind: 'switch', layoutId: l.id }),
    }))),
  ]
  const addWidget = ctx.addWidget
  if (addWidget) {
    const kinds = WIDGET_KIND_GROUPS.flatMap(({ group, label }) => widgetKindsOf(group)
      .filter((kind) => stored || !WIDGET_KIND_SPECS[kind].showsList)
      .map((kind): Command => ({
        id: `add-widget-${kind}`,
        name: widgetKindLabel(kind),
        category: 'layout',
        group: label,
        action: () => addWidget(kind),
      })))
    commands.push(stepCommand('add-widget', 'Add Widget', 'layout', kinds))
  }
  commands.push(
    { id: 'layout-new', name: 'New Layout…', category: 'layout', action: () => request({ kind: 'new' }) },
    { id: 'layout-duplicate', name: 'Duplicate Layout…', category: 'layout', action: () => request({ kind: 'duplicate' }) },
  )
  return commands
}

/**
 * Lens › No lens and each lens by name (the picked one marked): a pick is
 * the top bar's — the lens put back on if it was lifted, saved at once, as
 * the lens picker's. None while no lens is defined (Cycle Lens says where
 * to make one).
 */
function lensCommands(ctx: CommandContext): Command[] {
  const { lenses, activeLensId } = ctx.getLenses?.() ?? { lenses: [], activeLensId: null }
  if (lenses.length === 0) return []
  const picked = findLens(lenses, activeLensId)?.id ?? null
  const pick = (id: string | null) => () => {
    useUIStore.getState().setLensLifted(false)
    void lensActions.setActiveLens(id)
  }
  const choices: Command[] = [
    { id: 'lens-none', name: 'No lens', category: 'filter', ...(picked == null ? { current: true } : {}), action: pick(null) },
    ...lenses.map((l): Command => ({
      id: `lens-${l.id}`,
      name: l.name,
      category: 'filter',
      ...(l.id === picked ? { current: true } : {}),
      action: pick(l.id),
    })),
  ]
  return [stepCommand('lens-pick', 'Lens', 'filter', choices)]
}

const THEME_MODES: readonly { mode: ThemeMode; name: string }[] = [
  { mode: 'light', name: 'Light' },
  { mode: 'dark', name: 'Dark' },
  { mode: 'system', name: 'System' },
]

/** Theme › Light / Dark / System (the current one marked), as Settings › Appearance sets it. */
function themeCommands(ctx: CommandContext): Command[] {
  const themeMode = ctx.getThemeMode?.()
  if (!themeMode) return []
  return [stepCommand('theme', 'Theme', 'navigation', THEME_MODES.map(({ mode, name }): Command => ({
    id: `theme-${mode}`,
    name,
    category: 'navigation',
    ...(mode === themeMode ? { current: true } : {}),
    action: () => { void useSettingsStore.getState().setThemeMode(mode) },
  })))]
}

/** The palette's commands; key hints show the live keys (`overrides`: the user's shortcut changes). */
export function createCommands(
  ctx: CommandContext,
  overrides: ShortcutOverrides = useSettingsStore.getState().shortcutOverrides,
): Command[] {
  const keys = (id: ShortcutId) => shortcutLabel(id, overrides)
  /** A command that has a binding: its keys as the hint, its handler as the action. */
  const bound = (id: string, name: string, binding: ShortcutId, category: CommandCategory): Command => ({
    id, name, shortcut: keys(binding), category,
    action: () => { void runShortcutCommand(binding, ctx.shortcuts) },
  })
  const commands: Command[] = [
    // Navigation
    bound('open-settings', 'Open Settings', 'open-settings', 'navigation'),
    bound('focus-filter', 'Open Filter Menu', 'focus-filters', 'navigation'),
    bound('focus-search', 'Focus Filter Field', 'focus-search', 'navigation'),
    ...(ctx.shortcuts.openShortcutsModal ? [bound('keyboard-shortcuts', 'Keyboard Shortcuts', 'show-shortcuts', 'navigation')] : []),
    ...themeCommands(ctx),

    // Layouts
    ...layoutCommands(ctx),

    // Task actions
    bound('new-task', 'New Task', 'quick-add', 'task'),
    bound('undo', 'Undo', 'undo', 'task'),
    bound('redo', 'Redo', 'redo', 'task'),
    bound('select-all', 'Select All Tasks', 'select-all', 'task'),

    // Filter presets
    { id: 'filter-show-completed', name: 'Toggle Show Completed', category: 'filter', action: () => ctx.setShowCompleted(!ctx.getShowCompleted()) },
    { id: 'filter-clear', name: 'Clear All Filters', category: 'filter', action: ctx.clearAllFilters },
    bound('lens-cycle', 'Cycle Lens', 'cycle-lens', 'filter'),
    bound('lens-lift', 'Lift Lens / Put It Back', 'lift-lens', 'filter'),
    ...lensCommands(ctx),
    { id: 'filter-overdue', name: 'Show Overdue Tasks', category: 'filter', action: () => {
      ctx.clearAllFilters()
      const yesterday = new Date(startOfToday().getTime() - 1)
      ctx.setDateRange(null, yesterday)
    }},
  ]
  commands.push(...listZoomCommands())
  commands.push(...reviewListCommands(bound))
  commands.push(...reviewWithCommands(ctx))

  // Always offered: with no filter on, it lists every open task.
  const showScreenTasks = ctx.showScreenTasks
  if (showScreenTasks) {
    const n = ctx.getScreenTaskCount?.()
    commands.push({
      id: 'filter-show-tasks',
      name: 'Show Tasks Matching the Filter',
      ...(n != null ? { hint: tasksLabel(n) } : {}),
      category: 'filter',
      action: showScreenTasks,
    })
  }

  // Email
  const openCheckinDialog = ctx.openCheckinDialog
  if (openCheckinDialog) {
    commands.push({ id: 'email-checkins', name: 'Email task check-ins…', hint: 'choose people', category: 'email', action: () => openCheckinDialog() })
  }
  if (ctx.openCheckinImport) {
    commands.push({ id: 'email-import-reply', name: 'Import check-in reply…', category: 'email', action: ctx.openCheckinImport })
  }

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
      // The selection, as the copy shortcut copies it (no text-selection check: the palette is the ask).
      { id: 'bulk-copy', name: `Copy ${label}`, shortcut: keys('copy-selected'), category: 'bulk', action: () => { void copySelectedTasks() } },
      { id: 'bulk-delete', name: `Delete ${label}`, category: 'bulk', action: () => ctx.bulkRemove(ctx.getSelectedIds()) },
    )
  }

  return commands
}

/**
 * Zoom List In / Zoom List Out (D25 I1) for the list tab on screen the user
 * was last in (`zoomTargetTab`), each while it can step that way; the hint
 * says the step (`Rows → Lines`). None without a list tab on screen.
 */
function listZoomCommands(): Command[] {
  const tab = zoomTargetTab()
  if (!tab) return []
  const zoom = listTabZoom(tab)
  return (['in', 'out'] as const).flatMap((dir): Command[] => {
    const next = stepListZoom(zoom, dir)
    if (next === zoom) return []
    return [{
      id: `list-zoom-${dir}`,
      name: dir === 'in' ? 'Zoom List In' : 'Zoom List Out',
      hint: `${LIST_ZOOM_LABELS[zoom]} → ${LIST_ZOOM_LABELS[next]}`,
      category: 'navigation',
      action: () => { void stepListTabZoom(tab, dir) },
    }]
  })
}

/**
 * Review List: a jump to a Review widget with the list tab on screen the
 * user was last in (`reviewTargetTabId`), as its key does; the hint names
 * the list and its open tasks. None without a list tab on screen that shows
 * an open task, or while no layout has a Review widget.
 */
function reviewListCommands(bound: (id: string, name: string, binding: ShortcutId, category: CommandCategory) => Command): Command[] {
  const tabId = reviewTargetTabId()
  if (!tabId || !reviewJumpAvailable()) return []
  const name = useListWidgetStore.getState().shown[tabId]?.label
  const count = tasksLabel(listReviewCount(tabId))
  return [{ ...bound('review-list', 'Review List', 'review-list', 'task'), hint: name ? `${name} · ${count}` : count }]
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
