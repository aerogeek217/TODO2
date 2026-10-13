import { useEffect } from 'react'
import { useUIStore } from '../stores/ui-store'

/**
 * Drops the row selection a widget owns (`selectionScope === scope`) when the
 * widget unmounts — another tab picked, the cell collapsed or closed, a layout
 * switch — so the selection shortcuts (Space, Delete) never act on rows
 * nobody can see.
 */
export function useScopedSelectionRelease(scope: string): void {
  useEffect(() => () => {
    const ui = useUIStore.getState()
    if (ui.selectionScope === scope) ui.clearSelection()
  }, [scope])
}
