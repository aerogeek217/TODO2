import { useMemo } from 'react'
import { listsHeldByEdit, useWorkspaceStore } from '../stores/workspace-store'

/**
 * The lists no chooser offers (`workspace-store.listsHeldByEdit`): the ones
 * the layout edit mode made that nothing shows and that wait to be deleted —
 * made in the mode and undone there, or made before a Cancel whose Restore
 * offer still holds them.
 */
export function useHeldLists(): ReadonlySet<number> {
  const editing = useWorkspaceStore((s) => s.editing)
  const working = useWorkspaceStore((s) => s.working)
  const discardedLists = useWorkspaceStore((s) => s.discardedLists)
  return useMemo(() => new Set(listsHeldByEdit({ editing, working, discardedLists })), [editing, working, discardedLists])
}
