/**
 * A canvas-pinned placement that renders the single global note. Parallels
 * `FloatingCalendar` / `ListInset`: the widget stores position/size only;
 * content lives in the global `notes` row via `useNoteStore`. Popping a rail
 * notes slot onto the canvas creates one of these; docking removes it.
 */
export interface FloatingNote {
  id?: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
}
