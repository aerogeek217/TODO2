/**
 * The data attributes code outside a component reads from the rendered page:
 * the keyboard shortcuts and the palette (`services/keyboard-shortcuts`,
 * `services/command-registry`), the selection hooks and the list widgets' row
 * geometry. The components that emit them and the modules that read them both
 * name them from here — emit with `{...{ [TODO_ID_ATTR]: id }}`, read with
 * `attrSelector` / `getAttribute`.
 */

/** A task's row (list rows, the phone row) or calendar entry: its task id. */
export const TODO_ID_ATTR = 'data-todo-id'
/** The top bar's search field. */
export const SEARCH_INPUT_ATTR = 'data-search-input'
/** The top bar's filter tray (the field, the Filter button, the set filters' chips, the counter). */
export const FILTER_ROW_ATTR = 'data-filter-row'
/** The top bar's Filter button: what Open filter menu (`F`) presses. */
export const FILTER_MENU_ATTR = 'data-filter-menu'
/** The tray's Show N tasks (the filtered-tasks panel's toggle): where the focus goes back when the panel closes. */
export const SHOW_FILTERED_TASKS_ATTR = 'data-show-filtered-tasks'
/** A widget that owns a row selection (list, a glance row widget): its scope, the tab id. */
export const SELECTION_SCOPE_ATTR = 'data-selection-scope'
/** A list widget row: its occurrence key within the scope. */
export const ROW_KEY_ATTR = 'data-row-key'
/** A list widget row: the task it shows. */
export const ROW_TODO_ATTR = 'data-row-todo'
/** A list widget (a list tab's body): its tab id — the palette's Zoom List In / Out find the list on screen by it. */
export const LIST_WIDGET_ATTR = 'data-list-widget'
/** A Review widget (its face's host): its tab id — a Review button's jump moves the focus into it. */
export const REVIEW_WIDGET_ATTR = 'data-review-widget'
/** A review card's Status update line: where a jump puts the focus while a card shows. */
export const REVIEW_UPDATE_ATTR = 'data-review-update'
/** A Review widget's prompt row (its filter field): where a jump puts the focus while no card shows. */
export const PROMPT_ROW_ATTR = 'data-prompt-row'
/** A list widget section (a group): its key. */
export const LIST_SECTION_ATTR = 'data-list-section'
/** An area where a click keeps the row selection (the bulk bar, the snackbar, the row grid). */
export const KEEPS_SELECTION_ATTR = 'data-keeps-selection'
/**
 * Where the app's shortcuts stop: `none` = a text-field-like area, only the
 * bindings allowed in text fields fire; `modal` = a dialog, none fire.
 */
export const SHORTCUT_SCOPE_ATTR = 'data-shortcut-scope'
export type ShortcutScope = 'none' | 'modal'

/** The props that mark an element's shortcut scope: `{...shortcutScope('none')}`. */
export function shortcutScope(scope: ShortcutScope): { [SHORTCUT_SCOPE_ATTR]: ShortcutScope } {
  return { [SHORTCUT_SCOPE_ATTR]: scope }
}

/** `[attr]`, or `[attr="value"]`. */
export function attrSelector(attr: string, value?: string): string {
  return value === undefined ? `[${attr}]` : `[${attr}="${value}"]`
}

/** The task ids of the task rows / entries under `root`, in document order. */
export function readTodoIds(root: ParentNode = document): { rows: Element[]; ids: number[] } {
  const rows = Array.from(root.querySelectorAll(attrSelector(TODO_ID_ATTR)))
  return { rows, ids: rows.map((el) => Number(el.getAttribute(TODO_ID_ATTR))) }
}

/** The widget popup's panel (Open larger): the id of the tab it shows. */
export const WIDGET_POPUP_ATTR = 'data-widget-popup'

/** The widget popup's panel while it shows tab `tabId`, else null. */
export function widgetPopupOf(tabId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(attrSelector(WIDGET_POPUP_ATTR, CSS.escape(tabId)))
}

/**
 * The first element matching `selector` in tab `tabId`'s widget as it shows
 * now: in the widget popup while it shows that tab (an editor opened from
 * there opens beside it), else anywhere in the page.
 */
export function widgetElement(tabId: string, selector: string): HTMLElement | null {
  return widgetPopupOf(tabId)?.querySelector<HTMLElement>(selector) ?? document.querySelector<HTMLElement>(selector)
}
