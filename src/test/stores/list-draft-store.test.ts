import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { listAsShown, listAsShownNow, useListDraftStore } from '../../stores/list-draft-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useUndoStore } from '../../stores/undo-store'
import { beginReplaceHold } from '../../stores/replace-hold'
import { resetDb } from '../helpers'

async function addList(name: string): Promise<PersistedListDefinition> {
  const id = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 }, name })
  return useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)!
}

const drafts = () => useListDraftStore.getState().drafts
const stored = (id: number) => useListDefinitionStore.getState().listDefinitions.find((d) => d.id === id)!

beforeEach(async () => {
  await resetDb()
  useListDefinitionStore.setState({ listDefinitions: [] })
  // Ids restart with the database: no draft may outlive its test.
  useListDraftStore.setState({ drafts: {} })
})

describe('Edit list’s draft (the live preview)', () => {
  it('an edit makes a draft of the saved list; the saved list is untouched, and nothing is kept in the browser', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, grouping: 'people' }))
    expect(drafts()[def.id]).toMatchObject({ id: def.id, grouping: 'people' })
    expect(stored(def.id).grouping).toBe('none')
    expect(listAsShownNow(def.id)?.grouping).toBe('people')
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
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

  it('discard drops the draft without writing', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(def.id, (d) => ({ ...d, sort: 'name' }))
    useListDraftStore.getState().discard(def.id)
    expect(drafts()).toEqual({})
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('manual')
  })

  it('unknown lists are ignored; a list that isn’t saved shows as nothing', async () => {
    const def = await addList('Team')
    useListDraftStore.getState().edit(999, (d) => ({ ...d, sort: 'name' }))
    expect(drafts()).toEqual({})
    expect(listAsShown(undefined, { [def.id]: def })).toBeUndefined()
  })
})

describe('editList: a list edit written for good as one undo step', () => {
  it('writes the store and the database, one step with the snackbar; Undo and Redo put it back and again', async () => {
    const def = await addList('Team')
    const predicate = { ...emptyPredicate(), statusIds: [3] }
    expect(await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, sort: 'name', membership: { kind: 'custom', predicate } }), 'Edited list “Team”')).toBe(true)
    expect(stored(def.id)).toMatchObject({ sort: 'name' })
    expect((await db.listDefinitions.get(def.id))!.membership.predicate.statusIds).toEqual([3])
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Edited list “Team”' })

    await useUndoStore.getState().undo()
    expect(stored(def.id).sort).toBe('manual')
    expect((await db.listDefinitions.get(def.id))!.membership.predicate.statusIds).toBeNull()
    await useUndoStore.getState().redo()
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('name')
  })

  it('keeps the stored name for a blank one, and the stored owner', async () => {
    const def = await addList('Team')
    await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, name: '  ', sort: 'name', owner: { layoutId: 9 } }), 'x')
    expect(stored(def.id)).toMatchObject({ name: 'Team', sort: 'name', owner: { layoutId: 1 } })
  })

  it('Undo puts back only the parts the step changed: a later write to another part stays', async () => {
    const def = await addList('Team')
    await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, grouping: 'people' }), 'Grouped')
    await useListDefinitionStore.getState().update({ ...stored(def.id), showFilterLine: false })
    await useUndoStore.getState().undo()
    expect(stored(def.id)).toMatchObject({ grouping: 'none', showFilterLine: false })
  })

  it('nothing changed, or an unknown list: no write, no step', async () => {
    const def = await addList('Team')
    expect(await useListDefinitionStore.getState().editList(def.id, (d) => d, 'x')).toBe(false)
    expect(await useListDefinitionStore.getState().editList(999, (d) => ({ ...d, sort: 'name' }), 'x')).toBe(false)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('Undo once the list is gone says so', async () => {
    const def = await addList('Team')
    await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, sort: 'name' }), 'Sorted')
    await db.listDefinitions.delete(def.id)
    useListDefinitionStore.getState().forgetLists([def.id])
    await useUndoStore.getState().undo()
    expect(useUndoStore.getState().snackbar?.description).toContain('is gone')
  })

  it('under a data replace’s hold: nothing written, and Undo is refused (the step stays)', async () => {
    const def = await addList('Team')
    await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, sort: 'name' }), 'Sorted')
    const release = beginReplaceHold()
    expect(await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, grouping: 'people' }), 'Grouped')).toBe(false)
    await useUndoStore.getState().undo()
    release()
    expect((await db.listDefinitions.get(def.id))!).toMatchObject({ sort: 'name', grouping: 'none' })
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
  })
})
