import { describe, it, expect, beforeEach } from 'vitest'
import { CURRENT_DB_VERSION, db } from '../../data/database'
import { writeListDrafts } from '../../data/draft-storage'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { emptyPredicate } from '../../models'
import { applyKeptListDrafts, listAsShown, listAsShownNow, useListDraftStore } from '../../stores/list-draft-store'
import type { PersistedListDefinition } from '../../models/list-definition'
import { useUndoStore } from '../../stores/undo-store'
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

  it('keeps the stored name for a blank one, and the stored owner and lens switch', async () => {
    const def = await addList('Team')
    await useListDefinitionStore.getState().setIgnoreLens(def.id, true)
    await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, name: '  ', sort: 'name', owner: { layoutId: 9 }, ignoreLens: undefined }), 'x')
    expect(stored(def.id)).toMatchObject({ name: 'Team', sort: 'name', owner: { layoutId: 1 }, ignoreLens: true })
  })

  it('Undo puts back only the parts the step changed: a later lens switch stays', async () => {
    const def = await addList('Team')
    await useListDefinitionStore.getState().editList(def.id, (d) => ({ ...d, grouping: 'people' }), 'Grouped')
    await useListDefinitionStore.getState().setIgnoreLens(def.id, true)
    await useUndoStore.getState().undo()
    expect(stored(def.id)).toMatchObject({ grouping: 'none', ignoreLens: true })
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
})

describe('list drafts an older build kept (applied once at launch)', () => {
  /** A reload: nothing in memory, the database and the browser's kept drafts as they were. */
  async function reload() {
    useListDraftStore.setState({ drafts: {} })
    useListDefinitionStore.setState({ listDefinitions: [], loaded: false })
  }

  it('one whose list is still as it was saved is written for good — one undo step with the snackbar — and the key goes', async () => {
    const def = await addList('Team')
    writeListDrafts(new Map([[def.id, { draft: { ...def, sort: 'priority' }, base: def }]]))
    await reload()
    await applyKeptListDrafts()
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('priority')
    expect(drafts()).toEqual({})
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'Applied unsaved changes to list “Team”' })
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
    await useUndoStore.getState().undo()
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('manual')
    // Once per page load.
    writeListDrafts(new Map([[def.id, { draft: { ...def, sort: 'name' }, base: def }]]))
    await applyKeptListDrafts()
    expect((await db.listDefinitions.get(def.id))!.sort).toBe('manual')
  })

  it('one whose list changed since (or is gone) is dropped, not applied', async () => {
    const a = await addList('A')
    const b = await addList('B')
    writeListDrafts(new Map([
      [a.id, { draft: { ...a, sort: 'name' }, base: a }],
      [b.id, { draft: { ...b, sort: 'name' }, base: b }],
    ]))
    // Elsewhere (another tab, an import at launch): A renamed, B deleted.
    await db.listDefinitions.update(a.id, { name: 'A2' })
    await db.listDefinitions.delete(b.id)
    await reload()
    await applyKeptListDrafts()
    expect((await db.listDefinitions.get(a.id))!.sort).toBe('manual')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
  })

  it('a draft an older build kept without a schema version is dropped, never applied in its old shape', async () => {
    const id = await useListDefinitionStore.getState().add({ owner: { layoutId: 1 },
      name: 'Someday', membership: { kind: 'custom', predicate: { ...emptyPredicate(), dates: { deadline: { match: 'unset' } } } },
    })
    const old = {
      showCompleted: false, personIds: null, statusIds: null, searchText: '', dateField: 'deadline',
      dateRangeStart: null, dateRangeEnd: null, dateRangeIncludeNoDate: false, hasDeadline: false, hasFollowup: null, markers: null, tags: null,
    }
    const base = { id, name: 'Someday', sortOrder: 0, sort: 'manual', grouping: 'none', maxTasks: 10, limitMode: 'hard', membership: { kind: 'custom', predicate: old } }
    const draft = { ...base, sort: 'name', membership: { kind: 'custom', predicate: { ...old, dateField: 'created', dateRangeStart: { kind: 'relative', token: 'start-of-month' } } } }
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ [id]: { draft, base } }))
    await reload()
    await applyKeptListDrafts()
    expect((await db.listDefinitions.get(id))!.sort).toBe('manual')
    expect(localStorage.getItem('todo2-unsaved-lists')).toBeNull()
  })

  it('a draft kept in the current schema version is read as written', async () => {
    const def = await addList('Team')
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ [def.id]: { draft: { ...def, grouping: 'status' }, base: def, schemaVersion: CURRENT_DB_VERSION } }))
    await reload()
    await applyKeptListDrafts()
    expect((await db.listDefinitions.get(def.id))!.grouping).toBe('status')
  })
})
