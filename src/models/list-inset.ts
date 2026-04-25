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
   * User's current picks for a runtime-filter list-def (see
   * `ListDefinition.runtimeFilter`). Stored on the inset so re-opening the
   * canvas keeps the picks. OR-combined when the helper applies them. Ignored
   * when the referenced list-def does not declare a runtime filter. Lifted
   * from a scalar `number` to `number[]` by the v41 Dexie migration.
   */
  runtimeFilterValue?: number[]
}
