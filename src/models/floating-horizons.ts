/**
 * A canvas-pinned placement that renders the global horizon ribbon + selected
 * horizon list. Parallels `FloatingCalendar` / `FloatingTaskboard` / `FloatingNote`:
 * widget stores position/size only; ribbon state lives in settings.
 */
export interface FloatingHorizons {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}
