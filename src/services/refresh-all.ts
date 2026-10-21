import { useSettingsStore } from '../stores/settings-store'
import { useTodoStore } from '../stores/todo-store'
import { usePersonStore } from '../stores/person-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useNoteStore } from '../stores/note-store'
import { useListDraftStore } from '../stores/list-draft-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListOrderStore } from '../stores/list-order-store'
import { useUndoStore } from '../stores/undo-store'
import { useFilterStore } from '../stores/filter-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { useTrendEventsStore } from '../stores/trend-events-store'
import { useUIStore } from '../stores/ui-store'
import { clearUnsavedDrafts } from '../data/draft-storage'

/**
 * Reloads every store from IndexedDB after a data replace (import, backup
 * restore, audit cleanup, the sync file's load), resetting first what the
 * replaced data may make wrong (the undo stack, the filters, unsaved edits,
 * the selection …). Run by `replace-data.replaceData` — the one roster of the
 * stores a replace reloads.
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
  useListWidgetStore.setState({ picks: {}, collapsed: {} })
  // The replaced history (a table clear doesn't fire the event hooks).
  useTrendEventsStore.getState().invalidate()
  // Selected / edited task ids and a Quick Add draft's people / tags may now
  // name other rows.
  useUIStore.getState().clearSelection()
  useUIStore.getState().closeEditPopup()
  // Edit list names a list and a tab by id.
  useUIStore.getState().closeListEditor()
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
  // The replaced data may hold no Eisenhower list (or a setting naming
  // another): made / named again. A failure leaves the Eisenhower on what
  // the setting names now (every task when nothing).
  await useListDefinitionStore.getState().ensureEisenhowerList().catch((err: unknown) => {
    console.warn('[refresh] the Eisenhower list could not be made', err)
  })
  // Refetch every id: the replaced tables can keep a todo's id while
  // changing its people / tags, and the cached entries describe the old data.
  await loadAssignmentMaps({ refetch: true })
}

/**
 * The reload after an append import, which adds tasks (and the people, tags
 * and statuses they name) and replaces nothing: the task-side stores only —
 * the undo history, the selection, unsaved layout and list edits and the
 * filters stay, as nothing they name changed.
 */
export async function refreshTaskStores() {
  await Promise.all([
    useTodoStore.getState().loadAll(),
    usePersonStore.getState().load(),
    useTagStore.getState().load(),
    useStatusStore.getState().load(),
  ])
  await loadAssignmentMaps({ refetch: false })
}

/** The people / tag assignment maps of every loaded task, after the entities and tasks are loaded. */
async function loadAssignmentMaps(opts: { refetch: boolean }) {
  const todoIds = useTodoStore.getState().todos.map(t => t.id)
  await Promise.all([
    usePersonStore.getState().loadAssignments(todoIds, opts),
    useTagStore.getState().loadAssignments(todoIds, opts),
  ])
}
