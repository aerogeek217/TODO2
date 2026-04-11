export interface StickyNote {
  id?: number
  canvasId: number
  title?: string
  text: string
  x: number
  y: number
  width: number
  height: number
  color?: string
  createdAt: Date
  modifiedAt: Date
}
