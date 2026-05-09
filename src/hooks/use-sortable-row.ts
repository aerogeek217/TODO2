import { useCallback, type CSSProperties } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export interface SortableRowProps {
  setNodeRef: ReturnType<typeof useSortable>['setNodeRef']
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
  style: CSSProperties
  isDragging: boolean
}

/**
 * Bundles dnd-kit's `useSortable` with the `transform` + `transition` style
 * computation every sortable row in this app needs. Used by `HorizonRibbon`,
 * `DashboardListsEditor`, and `StatusEditor` — three reorderable editors that
 * each previously inlined the same five-line glue.
 */
export function useSortableRow(id: number | string): SortableRowProps {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return { setNodeRef, attributes, listeners, style, isDragging }
}

/**
 * Memoized `DragEndEvent` handler for the parent of a sortable list. Resolves
 * `active.id` / `over.id` to from/to indices via `items.findIndex(getId)`, then
 * forwards to `onReorder`. No-op when the drop is unknown or in-place. Pairs
 * with `useSortableRow` to cover the editor reorder flows end-to-end.
 */
export function useSortableReorderHandler<T>(
  items: readonly T[],
  getId: (item: T) => number | string | undefined,
  onReorder: (fromIndex: number, toIndex: number) => void,
): (event: DragEndEvent) => void {
  return useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((t) => getId(t) === active.id)
    const to = items.findIndex((t) => getId(t) === over.id)
    if (from !== -1 && to !== -1) onReorder(from, to)
  }, [items, getId, onReorder])
}
