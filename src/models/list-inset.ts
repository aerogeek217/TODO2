export interface ListInset {
  id?: number
  /** References a `ListDefinition` (unpinned from dashboard by default). */
  listDefinitionId: number
  canvasId: number
  x: number
  y: number
  width: number
  height: number
  isCollapsed: boolean
}
