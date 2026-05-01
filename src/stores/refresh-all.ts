import { useCanvasStore } from './canvas-store'
import { useSettingsStore } from './settings-store'
import { useTodoStore } from './todo-store'
import { useProjectStore } from './project-store'
import { usePersonStore } from './person-store'
import { useOrgStore } from './org-store'
import { useStatusStore } from './status-store'
import { useTagStore } from './tag-store'
import { useTaskboardStore } from './taskboard-store'
import { useNoteStore } from './note-store'
import { useListDefinitionStore } from './list-definition-store'
import { useListInsetStore } from './list-inset-store'
import { useFloatingNoteStore } from './floating-note-store'
import { useFloatingCalendarStore } from './floating-calendar-store'
import { useFloatingTaskboardStore } from './floating-taskboard-store'
import { useFloatingHorizonsStore } from './floating-horizons-store'
import { useFloatingStatusStore } from './floating-status-store'
import { useFloatingScoreboardStore } from './floating-scoreboard-store'
import { useFloatingSnoozeGraveyardStore } from './floating-snooze-graveyard-store'
import { useUndoStore } from './undo-store'
import { useFilterStore } from './filter-store'

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
  await useCanvasStore.getState().ensureDefault()
  await useSettingsStore.getState().load()
  const canvasId = useCanvasStore.getState().selectedCanvasId
  await Promise.all([
    useTodoStore.getState().loadAll(),
    useProjectStore.getState().loadAll(),
    usePersonStore.getState().load(),
    useOrgStore.getState().load(),
    useOrgStore.getState().loadPersonOrgMap(),
    useStatusStore.getState().load(),
    useTagStore.getState().load(),
    useTaskboardStore.getState().load(),
    useNoteStore.getState().load(),
    useListDefinitionStore.getState().load(),
    ...(canvasId != null ? [
      useListInsetStore.getState().loadByCanvas(canvasId),
      useFloatingNoteStore.getState().loadByCanvas(canvasId),
      useFloatingCalendarStore.getState().loadByCanvas(canvasId),
      useFloatingTaskboardStore.getState().loadByCanvas(canvasId),
      useFloatingHorizonsStore.getState().loadByCanvas(canvasId),
      useFloatingStatusStore.getState().loadByCanvas(canvasId),
      useFloatingScoreboardStore.getState().loadByCanvas(canvasId),
      useFloatingSnoozeGraveyardStore.getState().loadByCanvas(canvasId),
    ] : []),
  ])
  // Reload assignment maps after entities and todos are loaded
  const todoIds = useTodoStore.getState().todos.map(t => t.id)
  if (todoIds.length > 0) {
    await Promise.all([
      usePersonStore.getState().loadAssignments(todoIds),
      useOrgStore.getState().loadAssignments(todoIds),
      useTagStore.getState().loadAssignments(todoIds),
    ])
  }
}
