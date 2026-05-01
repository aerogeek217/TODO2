import type { SlotKind } from '../models/canvas-rails'
import { floatKindBySlotKind } from './float-kind-registry'

export interface FloatRect {
  x: number
  y: number
  width: number
  height: number
}

export interface FloatConversionArgs {
  sourceKind: SlotKind
  sourceId: number
  canvasId: number
  rect: FloatRect
  nextKind: SlotKind
  seed?: { listDefinitionId?: number }
}

/**
 * Convert a floating widget from one kind to another. Deletes the source
 * float record and creates a fresh float of the target kind at the same
 * position + size. React Flow re-keys on node id, so the node transition is
 * clean.
 *
 * For lens targets, resolves `listDefinitionId` from `seed` or falls back to
 * the first available list definition. Taskboard targets require no resolver
 * — the board is a singleton. Same-kind conversions are a no-op and return
 * the source id.
 *
 * Returns the new float's id, or `null` if conversion was aborted (e.g. no
 * list definitions available for a lens target) — in which case the source
 * is left intact.
 */
export async function convertFloatingKind(args: FloatConversionArgs): Promise<number | null> {
  const { sourceKind, sourceId, canvasId, rect, nextKind, seed } = args
  if (sourceKind === nextKind) return sourceId

  let resolvedListId: number | undefined
  if (nextKind === 'lens') {
    if (seed?.listDefinitionId != null) {
      resolvedListId = seed.listDefinitionId
    } else {
      const { useListDefinitionStore } = await import('../stores/list-definition-store')
      resolvedListId = useListDefinitionStore.getState().listDefinitions[0]?.id
    }
    if (resolvedListId == null) return null
  }

  await floatKindBySlotKind(sourceKind).remove(sourceId)

  const target = floatKindBySlotKind(nextKind)
  const id = await target.addFloat({
    canvasId,
    x: rect.x,
    y: rect.y,
    listDefinitionId: resolvedListId,
  })
  if (rect.width && rect.height) await target.setSize(id, rect.width, rect.height)
  return id
}
