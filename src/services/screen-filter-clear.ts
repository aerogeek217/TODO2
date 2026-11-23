import { useFilterStore } from '../stores/filter-store'
import { useUndoStore } from '../stores/undo-store'

/**
 * Clears the screen filter — chips, the typed expression, text, Show
 * completed, a pause — and offers it back: `Filter cleared · Undo` in the
 * snackbar puts it back as it was (`filter-store.snapshot` / `restore`).
 */
export function clearFilterWithUndo(): void {
  const store = useFilterStore.getState()
  if (!store.isActive) return
  const before = store.snapshot()
  store.clearAll()
  useUndoStore.getState().notify('Filter cleared', {
    action: { label: 'Undo', run: () => useFilterStore.getState().restore(before) },
  })
}
