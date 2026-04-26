/**
 * A canvas-pinned placement that renders the open-tasks-by-status stat widget.
 * Parallels `FloatingHorizons` / `FloatingCalendar` / `FloatingTaskboard`:
 * widget stores position/size only; content is derived from todo + status state.
 */
export interface FloatingStatus {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}
