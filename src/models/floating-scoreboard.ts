/**
 * A canvas-pinned placement that renders the discipline scoreboard stat widget
 * (defer / completion / lag metric cards). Parallels `FloatingHorizons` /
 * `FloatingCalendar`: widget stores position/size only; content is derived
 * from todo + todoEvents state.
 */
export interface FloatingScoreboard {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}
