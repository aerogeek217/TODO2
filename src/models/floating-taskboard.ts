/**
 * A canvas-pinned placement that renders the global `Taskboard`. Parallels
 * `FloatingCalendar` / `FloatingNote`: widget stores position/size only;
 * entries live on the singleton Taskboard row.
 */
export interface FloatingTaskboard {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}
