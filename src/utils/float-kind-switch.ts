import type { SlotKind } from '../models/canvas-rails'
import { useFloatingNoteStore } from '../stores/floating-note-store'
import { useFloatingCalendarStore } from '../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../stores/floating-taskboard-store'
import { useListInsetStore } from '../stores/list-inset-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useTaskboardStore } from '../stores/taskboard-store'
import { listInsetRepository } from '../data'

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
  seed?: { listDefinitionId?: number; taskboardId?: number }
}

/**
 * Convert a floating widget from one kind to another. Deletes the source
 * float record and creates a fresh float of the target kind at the same
 * position + size. React Flow re-keys on node id, so the node transition is
 * clean.
 *
 * For lens targets, resolves `listDefinitionId` from `seed` or falls back to
 * the first available list definition. For taskboard targets, resolves
 * `taskboardId` from `seed` or the store's default board (creating a default
 * if needed). Same-kind conversions are a no-op and return the source id.
 *
 * Returns the new float's id, or `null` if conversion was aborted (e.g. no
 * list definitions available for a lens target) — in which case the source
 * is left intact.
 */
export async function convertFloatingKind(args: FloatConversionArgs): Promise<number | null> {
  const { sourceKind, sourceId, canvasId, rect, nextKind, seed } = args
  if (sourceKind === nextKind) return sourceId

  let resolvedListId: number | undefined
  let resolvedTaskboardId: number | undefined

  if (nextKind === 'lens') {
    resolvedListId = seed?.listDefinitionId
      ?? useListDefinitionStore.getState().listDefinitions[0]?.id
    if (resolvedListId == null) return null
  } else if (nextKind === 'taskboard') {
    resolvedTaskboardId = seed?.taskboardId
      ?? useTaskboardStore.getState().defaultBoardId
      ?? (await useTaskboardStore.getState().ensureDefault())
  }

  switch (sourceKind) {
    case 'notes': await useFloatingNoteStore.getState().remove(sourceId); break
    case 'calendar': await useFloatingCalendarStore.getState().remove(sourceId); break
    case 'taskboard': await useFloatingTaskboardStore.getState().remove(sourceId); break
    case 'lens': await useListInsetStore.getState().remove(sourceId); break
  }

  const { x, y, width, height } = rect

  if (nextKind === 'notes') {
    const id = await useFloatingNoteStore.getState().add(canvasId, x, y)
    if (width && height) await useFloatingNoteStore.getState().updateSize(id, width, height)
    return id
  }
  if (nextKind === 'calendar') {
    const id = await useFloatingCalendarStore.getState().add(canvasId, x, y)
    if (width && height) await useFloatingCalendarStore.getState().updateSize(id, width, height)
    return id
  }
  if (nextKind === 'taskboard') {
    const id = await useFloatingTaskboardStore.getState().add(canvasId, resolvedTaskboardId!, x, y)
    if (width && height) await useFloatingTaskboardStore.getState().updateSize(id, width, height)
    return id
  }
  // lens
  const id = await useListInsetStore.getState().add(resolvedListId!, canvasId, x, y)
  if (width && height) {
    const store = useListInsetStore.getState()
    const inset = store.insets.find((i) => i.id === id)
    if (inset) await listInsetRepository.update({ ...inset, width, height })
    await store.loadByCanvas(canvasId)
  }
  return id
}
