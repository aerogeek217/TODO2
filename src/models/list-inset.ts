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
  /**
   * User's current pick for a runtime-filter list-def (see
   * `ListDefinition.runtimeFilter`). Stored on the inset so re-opening the
   * canvas keeps the pick. Ignored when the referenced list-def does not
   * declare a runtime filter.
   */
  runtimeFilterValue?: number
}
