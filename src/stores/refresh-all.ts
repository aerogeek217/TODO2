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
import { useTrendEventsStore } from './trend-events-store'
import { useUIStore } from './ui-store'
import { clearUnsavedDrafts } from '../data/draft-storage'

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
 * Every store goes through `load()`, not `ensureLoaded()` — that is a no-op
 * once the store has loaded, which would silently keep the pre-import data.
 */
export async function refreshAllStores() {
  useUndoStore.getState().clear()
  useFilterStore.getState().clearAll()
  // Unsaved list edits, prompt picks and collapsed groups are keyed by ids
  // the replaced data may reuse for other lists / tabs. The unsaved layout
  // and list edits kept for a reload go too — once the workspace has opened
  // (before that, at launch, they're from the last visit and are checked
  // against the loaded data when it opens).
  if (useWorkspaceStore.getState().hydrated) clearUnsavedDrafts()
  useListDraftStore.setState({ drafts: {} })
  useListWidgetStore.setState({ picks: {}, collapsed: {}, popover: null })
  // The replaced history (a table clear doesn't fire the event hooks).
  useTrendEventsStore.getState().invalidate()
  // Selected / edited task ids and a Quick Add draft's people / tags may now
  // name other rows.
  useUIStore.getState().clearSelection()
  useUIStore.getState().closeEditPopup()
  // Note text typed before the replace would be saved over the new note.
  useNoteStore.getState().discardPending()
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
