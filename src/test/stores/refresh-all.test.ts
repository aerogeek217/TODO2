import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { refreshAllStores } from '../../stores/refresh-all'
import { useSettingsStore } from '../../stores/settings-store'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useNoteStore } from '../../stores/note-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListOrderStore } from '../../stores/list-order-store'
import { useUndoStore } from '../../stores/undo-store'
import { useFilterStore } from '../../stores/filter-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useUIStore } from '../../stores/ui-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  // A fresh database reuses ids (todo 1, person 1, …): drop the caches an
  // earlier test filled so they can't describe this test's rows.
  for (const store of [useTodoStore, usePersonStore, useTagStore, useNoteStore, useUIStore]) {
    store.setState(store.getInitialState(), true)
  }
})

describe('refreshAllStores', () => {
  it('invokes load on every store that has one + parity loadAssignments', async () => {
    // Need at least one todo so the post-todos assignment loaders fire.
    await useTodoStore.getState().add('seed task')

    const spies = {
      // Pre-Promise.all
      undoClear: vi.spyOn(useUndoStore.getState(), 'clear'),
      filterClearAll: vi.spyOn(useFilterStore.getState(), 'clearAll'),
      settingsLoad: vi.spyOn(useSettingsStore.getState(), 'load'),
      // Promise.all — global stores
      todoLoadAll: vi.spyOn(useTodoStore.getState(), 'loadAll'),
      personLoad: vi.spyOn(usePersonStore.getState(), 'load'),
      statusLoad: vi.spyOn(useStatusStore.getState(), 'load'),
      tagLoad: vi.spyOn(useTagStore.getState(), 'load'),
      noteLoad: vi.spyOn(useNoteStore.getState(), 'load'),
      listDefinitionLoad: vi.spyOn(useListDefinitionStore.getState(), 'load'),
      listOrderLoad: vi.spyOn(useListOrderStore.getState(), 'load'),
      // Post-todos assignment loaders
      personLoadAssignments: vi.spyOn(usePersonStore.getState(), 'loadAssignments'),
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

  it('re-opens the workspace layout from the replaced data once the workspace was opened', async () => {
    await refreshAllStores()
    expect(useWorkspaceStore.getState().hydrated).toBe(false)
    expect(await db.layouts.count()).toBe(0)

    await useWorkspaceStore.getState().init()
    useWorkspaceStore.getState().addWidget('notes', { kind: 'layout' })
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
    await db.layouts.update(useWorkspaceStore.getState().activeLayoutId!, { name: 'Imported' })

    await refreshAllStores()
    expect(useWorkspaceStore.getState()).toMatchObject({ isDirty: false })
    expect(useWorkspaceStore.getState().working).toMatchObject({ name: 'Imported', columns: [] })
  })

  it('re-reads people and tag assignments that the replaced tables changed under a cached todo id', async () => {
    const todoId = await useTodoStore.getState().add('kept id')
    const aliceId = await usePersonStore.getState().add('Alice', 'AL')
    const bobId = await usePersonStore.getState().add('Bob', 'BO')
    const homeId = await useTagStore.getState().add('home')
    const workId = await useTagStore.getState().add('work')
    await db.todoPeople.add({ todoId, personId: aliceId })
    await db.todoTags.add({ todoId, tagId: homeId })
    await usePersonStore.getState().loadAssignments([todoId])
    await useTagStore.getState().loadAssignments([todoId])
    expect(usePersonStore.getState().assignedPeopleMap.get(todoId)?.map((p) => p.name)).toEqual(['Alice'])

    // A restore swaps the join rows but keeps the todo's id.
    await db.todoPeople.clear()
    await db.todoTags.clear()
    await db.todoPeople.add({ todoId, personId: bobId })
    await db.todoTags.add({ todoId, tagId: workId })

    await refreshAllStores()

    expect(usePersonStore.getState().assignedPeopleMap.get(todoId)?.map((p) => p.name)).toEqual(['Bob'])
    expect(useTagStore.getState().assignedTagsMap.get(todoId)?.map((t) => t.name)).toEqual(['work'])
  })

  it('clears the selection, the open editor and the Quick Add draft (their ids may now name other tasks)', async () => {
    const ui = useUIStore.getState()
    ui.setScopedSelection('tab-1', { ids: [1, 2], anchorKey: 'a', cursorKey: 'b', cursorTodoId: 2 })
    ui.openEditPopup(1)
    ui.setQuickAddDraft({ rawTitle: 'half typed', defaults: { personIds: [3], statusId: null, tagIds: [], markers: {} } as never })

    await refreshAllStores()

    const after = useUIStore.getState()
    expect(after.selectedTodoIds.size).toBe(0)
    expect(after.selectionScope).toBeNull()
    expect(after.selectionAnchorId).toBeNull()
    expect(after.editPopupMode).toBeNull()
    expect(after.selectedTodoId).toBeNull()
    expect(after.quickAddDraft).toBeNull()
  })

  it('drops note text not saved yet, so it is not saved over the imported note', async () => {
    await useNoteStore.getState().load()
    const id = useNoteStore.getState().activeId!
    useNoteStore.getState().setContent(id, 'typed just before the import')

    // The import replaces the note underneath the store.
    await db.notes.update(id, { content: 'imported note' })
    await refreshAllStores()
    // Whatever save was still to come runs now.
    await useNoteStore.getState().flush()

    expect((await db.notes.get(id))?.content).toBe('imported note')
    expect(useNoteStore.getState().notes.get(id)?.content).toBe('imported note')
    expect(useNoteStore.getState().pending).toBeNull()
  })
})
