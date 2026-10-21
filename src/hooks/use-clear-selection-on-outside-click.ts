import { useEffect } from 'react'
import { DRAG_ACTIVATION_DISTANCE_PX } from '../constants'
import { useUIStore } from '../stores/ui-store'
import { attrSelector, KEEPS_SELECTION_ATTR, TODO_ID_ATTR } from '../utils/dom-contract'

/** The element the app renders into (`index.html`); portaled UI sits outside it. */
const APP_ROOT_ID = 'root'

/**
 * Where a click keeps the row selection: a task row (anything carrying
 * `data-todo-id`), an area marked `data-keeps-selection` (the bulk bar, the
 * snackbar), and menus / dialogs / pickers.
 */
const KEEPS_SELECTION = [
  attrSelector(TODO_ID_ATTR), attrSelector(KEEPS_SELECTION_ATTR),
  '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]',
].join(', ')

/**
 * Whether a click on `target` keeps the row selection: it's on a row, the
 * bulk bar or a menu / dialog, or outside `appRoot` — portaled UI (popovers,
 * pickers, dialogs) is opened from the rows or the bulk bar.
 */
export function clickKeepsSelection(target: EventTarget | null, appRoot: Element | null): boolean {
  if (!(target instanceof Element) || !target.isConnected) return true
  if (appRoot && !appRoot.contains(target)) return true
  return target.closest(KEEPS_SELECTION) !== null
}

/**
 * Clears the row selection on a click anywhere outside the rows — the top
 * bar, another widget, a header, the workspace background. Runs in the
 * capture phase, so handlers that stop propagation don't hide the click.
 * A click that ends a drag (the pointer moved past the drag threshold since
 * it went down: a tab, row or divider drag) keeps it.
 */
export function useClearSelectionOnOutsideClick(): void {
  useEffect(() => {
    let down: { x: number; y: number } | null = null
    const onPointerDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onClick = (e: MouseEvent) => {
      const start = down
      down = null
      const ui = useUIStore.getState()
      if (ui.selectedTodoIds.size === 0) return
      if (start && e.detail > 0 && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= DRAG_ACTIVATION_DISTANCE_PX) return
      if (clickKeepsSelection(e.target, document.getElementById(APP_ROOT_ID))) return
      ui.clearSelection()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [])
}
