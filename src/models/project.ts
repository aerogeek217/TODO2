export interface Project {
  id?: number
  name: string
  canvasId: number
  positionX: number
  positionY: number
  width?: number
  isCollapsed: boolean
  color?: string
  sortOrder: number
  createdAt: Date
}
