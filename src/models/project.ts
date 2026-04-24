export type ProjectGroupBy = 'status' | 'people' | 'org' | 'scheduled' | 'deadline' | 'date'

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
  groupBy?: ProjectGroupBy | null
  groupOrder?: string[]
}
