import { useSettingsStore } from './settings-store'
import { useTodoStore } from './todo-store'
import { usePersonStore } from './person-store'
import { useStatusStore } from './status-store'
import { useTagStore } from './tag-store'
import { useNoteStore } from './note-store'
import { useListDraftStore } from './list-draft-store'
import { useListWidgetStore } from './list-widget-store'
import { useListDefinitionStore } from './list-definition-store'
import { useListOrderStore } from './list-order-store'
import { useUndoStore } from './undo-store'
import { useFilterStore } from './filter-store'
import { useWorkspaceStore } from './workspace-store'

/**
 * Reload every Zustand store from IndexedDB after a destructive replace
 * (file import, backup restore, audit cleanup, legacy migration).
 *
 * Why a top-level module and not a method on `file-storage-store`: this is
 * called by `file-ops-store` too, so colocating it under either store
 * creates a cross-store import. Living in its own module keeps each store
 * an entity owner and this function the single seam that knows about all
 * of them.
 *
 * `tagStore` and `listDefinitionStore` go through `load()`, not
 * `ensureLoaded()` — `makeEnsureLoaded` short-circuits on a closure-cached
 * `loaded = true`, which would silently keep the pre-import data.
 */
export async function refreshAllStores() {
  useUndoStore.getState().clear()
  useFilterStore.getState().clearAll()
  // Unsaved list edits, prompt picks and collapsed groups are keyed by ids
  // the replaced data may reuse for other lists / tabs.
  useListDraftStore.setState({ drafts: {} })
  useListWidgetStore.setState({ picks: {}, collapsed: {}, popover: null })
  await useSettingsStore.getState().load()
  await Promise.all([
    useTodoStore.getState().loadAll(),
    usePersonStore.getState().load(),
    useStatusStore.getState().load(),
    useTagStore.getState().load(),
    useNoteStore.getState().load(),
    useListDefinitionStore.getState().load(),
    useListOrderStore.getState().load(),
    // Re-open the active layout from the replaced data (drops any unsaved
    // working copy); untouched until the workspace has been opened once.
    ...(useWorkspaceStore.getState().hydrated ? [useWorkspaceStore.getState().init()] : []),
  ])
  // Reload assignment maps after entities and todos are loaded. Refetch every
  // id: the replaced tables can keep a todo's id while changing its people /
  // tags, and the cached entries describe the old data.
  const todoIds = useTodoStore.getState().todos.map(t => t.id)
  await Promise.all([
    usePersonStore.getState().loadAssignments(todoIds, { refetch: true }),
    useTagStore.getState().loadAssignments(todoIds, { refetch: true }),
  ])
}
