/**
 * A canvas-pinned placement that renders a specific `Taskboard`. Parallels
 * `FloatingCalendar` / `FloatingNote`: widget stores position/size only;
 * entries live on the referenced Taskboard row.
 */
export interface FloatingTaskboard {
  id?: number
  canvasId: number
  taskboardId: number
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}
