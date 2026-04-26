/**
 * A canvas-pinned placement that renders the snooze-graveyard stat widget
 * (top-N most-rescheduled open todos). Parallels `FloatingHorizons` /
 * `FloatingCalendar`: widget stores position/size only; content is derived
 * from todo + todoEvents state.
 */
export interface FloatingSnoozeGraveyard {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}
