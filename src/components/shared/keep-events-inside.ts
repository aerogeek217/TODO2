import type { MouseEvent, PointerEvent } from 'react'

/**
 * Spread on a portaled layer's root (a row picker, a sheet): React bubbles
 * its events through the portal to the opener — a task row's select, drag
 * (`pointerdown` → dnd-kit), open (`dblclick`) and task-menu (`contextmenu`)
 * handlers — so they stop here. `contextmenu` only stops: the browser's own
 * menu (copy / paste in a field) still opens. The app's outside-press
 * listeners run in the capture phase, so they still see every press.
 */
export const KEEP_EVENTS_INSIDE = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
  onMouseDown: (e: MouseEvent) => e.stopPropagation(),
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onContextMenu: (e: MouseEvent) => e.stopPropagation(),
} as const
