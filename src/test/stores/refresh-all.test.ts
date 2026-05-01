import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { refreshAllStores } from '../../stores/refresh-all'
import { useCanvasStore } from '../../stores/canvas-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { useProjectStore } from '../../stores/project-store'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTaskboardStore } from '../../stores/taskboard-store'
import { useNoteStore } from '../../stores/note-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListInsetStore } from '../../stores/list-inset-store'
import { useFloatingNoteStore } from '../../stores/floating-note-store'
import { useFloatingCalendarStore } from '../../stores/floating-calendar-store'
import { useFloatingTaskboardStore } from '../../stores/floating-taskboard-store'
import { useFloatingHorizonsStore } from '../../stores/floating-horizons-store'
import { useFloatingStatusStore } from '../../stores/floating-status-store'
import { useFloatingScoreboardStore } from '../../stores/floating-scoreboard-store'
import { useFloatingSnoozeGraveyardStore } from '../../stores/floating-snooze-graveyard-store'
import { useUndoStore } from '../../stores/undo-store'
import { useFilterStore } from '../../stores/filter-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('refreshAllStores', () => {
  it('invokes load/loadByCanvas on every store that has one + parity loadAssignments', async () => {
    // Need a canvas so the per-canvas branch fires.
    await useCanvasStore.getState().ensureDefault()
    // Need at least one todo so the post-todos assignment loaders fire.
    await useTodoStore.getState().add('seed task')

    const spies = {
      // Pre-Promise.all
      undoClear: vi.spyOn(useUndoStore.getState(), 'clear'),
      filterClearAll: vi.spyOn(useFilterStore.getState(), 'clearAll'),
      canvasEnsureDefault: vi.spyOn(useCanvasStore.getState(), 'ensureDefault'),
      settingsLoad: vi.spyOn(useSettingsStore.getState(), 'load'),
      // Promise.all — global stores
      todoLoadAll: vi.spyOn(useTodoStore.getState(), 'loadAll'),
      projectLoadAll: vi.spyOn(useProjectStore.getState(), 'loadAll'),
      personLoad: vi.spyOn(usePersonStore.getState(), 'load'),
      orgLoad: vi.spyOn(useOrgStore.getState(), 'load'),
      orgLoadPersonOrgMap: vi.spyOn(useOrgStore.getState(), 'loadPersonOrgMap'),
      statusLoad: vi.spyOn(useStatusStore.getState(), 'load'),
      tagLoad: vi.spyOn(useTagStore.getState(), 'load'),
      taskboardLoad: vi.spyOn(useTaskboardStore.getState(), 'load'),
      noteLoad: vi.spyOn(useNoteStore.getState(), 'load'),
      listDefinitionLoad: vi.spyOn(useListDefinitionStore.getState(), 'load'),
      // Promise.all — per-canvas stores
      listInsetLoadByCanvas: vi.spyOn(useListInsetStore.getState(), 'loadByCanvas'),
      floatingNoteLoadByCanvas: vi.spyOn(useFloatingNoteStore.getState(), 'loadByCanvas'),
      floatingCalendarLoadByCanvas: vi.spyOn(useFloatingCalendarStore.getState(), 'loadByCanvas'),
      floatingTaskboardLoadByCanvas: vi.spyOn(useFloatingTaskboardStore.getState(), 'loadByCanvas'),
      floatingHorizonsLoadByCanvas: vi.spyOn(useFloatingHorizonsStore.getState(), 'loadByCanvas'),
      floatingStatusLoadByCanvas: vi.spyOn(useFloatingStatusStore.getState(), 'loadByCanvas'),
      floatingScoreboardLoadByCanvas: vi.spyOn(useFloatingScoreboardStore.getState(), 'loadByCanvas'),
      floatingSnoozeGraveyardLoadByCanvas: vi.spyOn(useFloatingSnoozeGraveyardStore.getState(), 'loadByCanvas'),
      // Post-todos assignment loaders
      personLoadAssignments: vi.spyOn(usePersonStore.getState(), 'loadAssignments'),
      orgLoadAssignments: vi.spyOn(useOrgStore.getState(), 'loadAssignments'),
      tagLoadAssignments: vi.spyOn(useTagStore.getState(), 'loadAssignments'),
    }

    await refreshAllStores()

    for (const [name, spy] of Object.entries(spies)) {
      expect(spy, `${name} should be invoked by refreshAllStores`).toHaveBeenCalled()
    }
  })

  it('uses load() (not ensureLoaded) so post-import data replaces cached state', async () => {
    // Trip ensureLoaded's closure cache by calling it once.
    await useTagStore.getState().ensureLoaded()
    await useListDefinitionStore.getState().ensureLoaded()

    // ensureLoaded would now no-op; refresh must call the underlying load() directly.
    const tagLoadSpy = vi.spyOn(useTagStore.getState(), 'load')
    const listDefLoadSpy = vi.spyOn(useListDefinitionStore.getState(), 'load')

    await refreshAllStores()

    expect(tagLoadSpy).toHaveBeenCalled()
    expect(listDefLoadSpy).toHaveBeenCalled()
  })
})
