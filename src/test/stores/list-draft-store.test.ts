import { describe, it, expect, beforeEach } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { draftListIds, getUnsavedListIds, useListDraftStore } from '../../stores/list-draft-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

async function addList(name: string): Promise<PersistedListDefinition> {
  const id = await useListDefinitionStore.getState().add({ name })
  return useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)!
}

const drafts = () => useListDraftStore.getState().drafts

beforeEach(async () => {
  await resetDb()
  useListDefinitionStore.setState({ listDefinitions: [] })
  // Ids restart with the database: no draft may outlive its test.
  useListDraftStore.setState({ drafts: {} })
})

describe('list drafts', () => {
  it('an edit makes a draft of the saved list; the saved list is untouched', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, grouping: 'people' }))
    expect(drafts()[def.id]).toMatchObject({ id: def.id, grouping: 'people' })
    expect(useListDefinitionStore.getState().listDefinitions[0]!.grouping).toBe('none')
    expect(getUnsavedListIds()).toEqual([def.id])
  })

  it('edits build on the draft, and an edit back to the saved list drops it', async () => {
    const def = await addList('Team')
    const { edit } = useListDraftStore.getState()
    edit(def.id, (d) => ({ ...d, sort: 'name' }))
    edit(def.id, (d) => ({ ...d, grouping: 'status' }))
    expect(drafts()[def.id]).toMatchObject({ sort: 'name', grouping: 'status' })
    edit(def.id, (d) => ({ ...d, sort: 'manual' }))
    edit(def.id, (d) => ({ ...d, grouping: 'none' }))
    expect(drafts()[def.id]).toBeUndefined()
  })

  it('save writes the draft to the store and the database and drops it', async () => {
    const def = await addList('Team')
    const predicate = { ...emptyPredicate(), statusIds: [3] }
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, membership: { kind: 'custom', predicate } }))
    await useListDraftStore.getState().save(def.id)
    expect(drafts()).toEqual({})
    expect(useListDefinitionStore.getState().listDefinitions[0]!.membership.predicate.statusIds).toEqual([3])
    expect((await db.listDefinitions.get(def.id))!.membership.predicate.statusIds).toEqual([3])
  })

  it('save keeps the saved name when the draft name is blank', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, name: '  ', sort: 'name' }))
    await useListDraftStore.getState().save(def.id)
    expect(useListDefinitionStore.getState().listDefinitions[0]).toMatchObject({ name: 'Team', sort: 'name' })
  })

  it('discard drops the draft without writing', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, sort: 'name' }))
    useListDraftStore.getState().discard(def.id)
    expect(drafts()).toEqual({})
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('manual')
  })

  it('revert drops the draft and offers Undo, which brings the draft back', async () => {
    const def = await addList('Team')
    await useListDraftStore.getState().restore()
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, sort: 'priority', grouping: 'status' }))
    useListDraftStore.getState().revert(def.id)
    expect(drafts()).toEqual({})
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'List changes reverted' })
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('manual')

    await useUndoStore.getState().undo()
    expect(drafts()[def.id]).toMatchObject({ sort: 'priority', grouping: 'status' })
    expect(JSON.parse(localStorage.getItem('todo2-unsaved-lists')!)[def.id].draft.sort).toBe('priority')
    // Redo reverts again.
    await useUndoStore.getState().redo()
    expect(drafts()).toEqual({})
  })

  it('revert without a draft does nothing (no undo entry)', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().revert(def.id)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('unknown lists are ignored; drafts of deleted lists are not unsaved', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(999, (d) => ({ ...d, sort: 'name' }))
    expect(drafts()).toEqual({})
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, sort: 'name' }))
    expect(draftListIds(drafts(), [])).toEqual([])
    await useListDraftStore.getState().save(def.id + 1)
    expect(drafts()[def.id]).toBeDefined()
  })
})

describe('list drafts kept for a reload', () => {
  /** A reload: nothing in memory, the database and the browser's kept drafts as they were. */
  async function reload() {
    useListDraftStore.setState({ drafts: {} })
    useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
    await useListDraftStore.getState().restore()
    // The workspace loads the lists itself.
    await useListDefinitionStore.getState().ensureLoaded()
  }

  it('an unsaved edit survives a reload, still unsaved; save and discard forget it', async () => {
    const def = await addList('Team')
    await useListDraftStore.getState().restore()
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, sort: 'priority' }))
    await reload()
    expect(drafts()[def.id]).toMatchObject({ sort: 'priority' })
    expect(getUnsavedListIds()).toEqual([def.id])
    // The database never saw it.
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('manual')

    useListDraftStore.getState().discard(def.id)
    await reload()
    expect(drafts()).toEqual({})

    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, sort: 'name' }))
    await useListDraftStore.getState().save(def.id)
    await reload()
    expect(drafts()).toEqual({})
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('name')
  })

  it('a kept draft whose list changed since (or is gone) is dropped, not applied', async () => {
    const a = await addList('A')
    const b = await addList('B')
    await useListDraftStore.getState().restore()
    useListDraftStore.getState().edit(a.id, (d) => ({ ...d, sort: 'name' }))
    useListDraftStore.getState().edit(b.id, (d) => ({ ...d, sort: 'name' }))
    // Elsewhere (another tab, an import at launch): A renamed, B deleted.
    await db.listDefinitions.update(a.id, { name: 'A2' })
    await db.listDefinitions.delete(b.id)
    await reload()
    expect(drafts()).toEqual({})
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
  })

  it('nothing is written before the kept drafts were read back', async () => {
    const def = await addList('Team')
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ [def.id]: { draft: { ...def, sort: 'name' }, base: def } }))
    // An edit to another field before restore() must not overwrite what's kept.
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, grouping: 'people' }))
    expect(JSON.parse(localStorage.getItem('todo2-unsaved-lists')!)[def.id].draft.sort).toBe('name')
    await useListDraftStore.getState().restore()
    // What's on screen wins over what was kept.
    expect(drafts()[def.id]).toMatchObject({ grouping: 'people', sort: 'manual' })
  })

  it('a draft an older build kept comes back through the schema upgrade (date filters per type), never in the old shape', async () => {
    // The stored list as the v64 upgrade left it: "has due date: no" became a No date clause.
    const id = await useListDefinitionStore.getState().add({
      name: 'Someday', membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { deadline: { match: 'unset' } } } },
    })
    const old = {
      showCompleted: false, personIds: null, statusIds: null, searchText: '', dateField: 'deadline',
      dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: false, hasFollowup: null, markers: null, tags: null,
    }
    const base = { id, name: 'Someday', sortOrder: 0, sort: 'manual', grouping: 'none', maxTasks: 10, limitMode: 'hard', membership: { kind: 'custom', predicate: old } }
    const draft = { ...base, sort: 'name', membership: { kind: 'custom', predicate: { ...old, dateField: 'created', dateRangeStart: { kind: 'relative', token: 'start-of-month' } } } }
    // Kept by the build before (no schema version on the record).
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ [id]: { draft, base } }))
    await reload()
    expect(drafts()[id]).toEqual({
      id, name: 'Someday', sortOrder: 0, sort: 'name', grouping: 'none',
      membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { deadline: { match: 'unset' }, created: { match: 'range', start: { kind: 'relative', token: 'start-of-month' }, end: null } } } },
    })
    expect(getUnsavedListIds()).toEqual([id])
    // Kept again in the current shape, with its schema version.
    const kept = JSON.parse(localStorage.getItem('todo2-unsaved-lists')!)[id]
    expect(kept.schemaVersion).toBe(CURRENT_DB_VERSION)
    expect('dateField' in kept.draft.membership.predicate).toBe(false)
  })

})
