import { useEffect, useId, useSyncExternalStore } from 'react'
import { registerModuleReset } from '../../../utils/module-reset'

/**
 * Which filter chip rows (`PredicateChips`) have a picker or panel open. A
 * row dissolves an or group left with one item only while none has: a picker
 * open in another row on the same filter (Edit list beside the list's filter
 * line, a pane's editor) still edits the group by its place, and a dissolve
 * under it would send its next edit to the wrong clauses.
 */
const open = new Set<string>()
const listeners = new Set<() => void>()
let snapshot = false

function emit(): void {
  const next = open.size > 0
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const getSnapshot = () => snapshot

/** Registers this row's picker as open while `isOpen`. */
export function useFilterPickerOpen(isOpen: boolean): void {
  const id = useId()
  useEffect(() => {
    if (!isOpen) return
    open.add(id)
    emit()
    return () => {
      open.delete(id)
      emit()
    }
  }, [id, isOpen])
}

/** Whether any filter chip row has a picker or panel open. */
export function useAnyFilterPickerOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

registerModuleReset(() => {
  open.clear()
  snapshot = false
})
