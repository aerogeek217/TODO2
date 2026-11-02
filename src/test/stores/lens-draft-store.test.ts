import { describe, it, expect, beforeEach, vi } from 'vitest'
import { settingsRepository } from '../../data'
import { emptyPredicate, type TodoPredicate } from '../../models/filter-predicate'
import { deleteLens } from '../../services/lenses'
import { refreshAllStores } from '../../services/refresh-all'
import { liveLensDraft, settleLensDraft, useLensDraftStore } from '../../stores/lens-draft-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

const drafts = () => useLensDraftStore.getState()
const ui = () => useUIStore.getState()
const lens = (id: string) => useSettingsStore.getState().lenses.find((l) => l.id === id)
const waiting: TodoPredicate = { ...emptyPredicate(), statusIds: [3], negate: { statusIds: true } }
const prompt = () => ui().confirmPrompts.at(0)
/** Lets the prompt's answer (and the save it starts) run. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(async () => {
  await resetDb()
  await useSettingsStore.getState().setLenses([
    { id: 'lens-a', name: 'Alpha', predicate: emptyPredicate() },
    { id: 'lens-b', name: 'Beta', predicate: emptyPredicate() },
  ], 'seed')
  useUndoStore.getState().clear()
})

describe('lens-draft-store', () => {
  it('an edit is held, not saved; the saved filter again is no draft; a lens no one has none', () => {
    drafts().edit('lens-a', waiting)
    expect(drafts().draft).toEqual({ lensId: 'lens-a', predicate: waiting })
    expect(lens('lens-a')!.predicate.statusIds).toBeNull()
    expect(liveLensDraft()?.lens.id).toBe('lens-a')
    expect(useUndoStore.getState().undoStack).toHaveLength(0)

    drafts().edit('lens-a', emptyPredicate())
    expect(drafts().draft).toBeNull()
    drafts().edit('lens-gone', waiting)
    expect(drafts().draft).toBeNull()
  })

  it('Save writes the filter as one undo step and drops the draft; a failed save keeps it', async () => {
    drafts().edit('lens-a', waiting)
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('quota'))
    expect(await drafts().save()).toBe(false)
    expect(drafts().draft?.lensId).toBe('lens-a')
    expect(lens('lens-a')!.predicate.statusIds).toBeNull()

    expect(await drafts().save()).toBe(true)
    expect(drafts().draft).toBeNull()
    expect(lens('lens-a')!.predicate.statusIds).toEqual([3])
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Changed lens “Alpha”'])
    expect(await drafts().save()).toBe(true)
  })

  it('Revert drops it; Undo brings it back — refused while another lens has one', async () => {
    ui().openSettings('lenses')
    drafts().edit('lens-a', waiting)
    drafts().revert()
    expect(drafts().draft).toBeNull()
    expect(useUndoStore.getState().snackbar?.description).toBe('Lens changes reverted')
    await useUndoStore.getState().undo()
    expect(drafts().draft).toEqual({ lensId: 'lens-a', predicate: waiting })
    await useUndoStore.getState().redo()
    expect(drafts().draft).toBeNull()

    drafts().edit('lens-b', waiting)
    await useUndoStore.getState().undo()
    expect(drafts().draft?.lensId).toBe('lens-b')
    expect(useUndoStore.getState().snackbar?.description).toBe('Save or revert the changes to “Beta” first.')
  })

  it('Revert’s Undo is refused unless Settings is open on Tasks (where the editor shows the draft)', async () => {
    ui().openSettings('lenses')
    drafts().edit('lens-a', waiting)
    drafts().revert()
    const refused = 'Open Settings › Tasks › Lenses to bring back the changes to “Alpha”.'

    ui().hideSettings()
    await useUndoStore.getState().undo()
    expect(drafts().draft).toBeNull()
    expect(useUndoStore.getState().snackbar?.description).toBe(refused)
    // Refused, it stays on the stack to try again.
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Lens changes reverted'])

    ui().openSettings('database')
    await useUndoStore.getState().undo()
    expect(drafts().draft).toBeNull()
    expect(useUndoStore.getState().snackbar?.description).toBe(refused)

    ui().setSettingsSection('tasks')
    await useUndoStore.getState().undo()
    expect(drafts().draft).toEqual({ lensId: 'lens-a', predicate: waiting })
  })

  it('deleting the drafted lens drops the draft; deleting another keeps it; a data replace drops it', async () => {
    drafts().edit('lens-a', waiting)
    await deleteLens('lens-b')
    expect(drafts().draft?.lensId).toBe('lens-a')
    await deleteLens('lens-a')
    expect(drafts().draft).toBeNull()
    await useUndoStore.getState().undo()
    expect(lens('lens-a')!.predicate.statusIds).toBeNull()
    expect(drafts().draft).toBeNull()

    drafts().edit('lens-a', waiting)
    await refreshAllStores()
    expect(drafts().draft).toBeNull()
  })
})

describe('settleLensDraft — Save / Discard / Keep editing', () => {
  it('without a draft goes on at once, asking nothing', async () => {
    expect(await settleLensDraft()).toBe(true)
    expect(ui().confirmPrompts).toHaveLength(0)
  })

  it('asks once, however often it is asked while on screen; each answer', async () => {
    drafts().edit('lens-a', waiting)
    const first = settleLensDraft()
    const again = settleLensDraft()
    expect(ui().confirmPrompts).toHaveLength(1)
    expect(prompt()).toMatchObject({ title: 'Save changes to lens “Alpha”?', confirmLabel: 'Save lens', discardLabel: 'Discard', cancelLabel: 'Keep editing' })

    ui().answerConfirmation(false)
    expect(await first).toBe(false)
    expect(await again).toBe(false)
    expect(drafts().draft?.lensId).toBe('lens-a')

    const discard = settleLensDraft()
    ui().answerConfirmation('discard')
    expect(await discard).toBe(true)
    expect(drafts().draft).toBeNull()
    expect(lens('lens-a')!.predicate.statusIds).toBeNull()

    drafts().edit('lens-a', waiting)
    const save = settleLensDraft()
    ui().answerConfirmation(true)
    expect(await save).toBe(true)
    expect(drafts().draft).toBeNull()
    expect(lens('lens-a')!.predicate.statusIds).toEqual([3])
  })

  it('a Save that fails stays (false): the draft is kept', async () => {
    drafts().edit('lens-a', waiting)
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('quota'))
    const save = settleLensDraft()
    ui().answerConfirmation(true)
    expect(await save).toBe(false)
    expect(drafts().draft?.lensId).toBe('lens-a')
  })
})

describe('ui-store: Settings asks before it leaves a lens draft', () => {
  beforeEach(() => {
    ui().openSettings('lenses')
    drafts().edit('lens-a', waiting)
  })

  it('closeSettings asks; Keep editing leaves it open on the same section with the draft; Discard closes', async () => {
    ui().closeSettings()
    expect(prompt()?.title).toBe('Save changes to lens “Alpha”?')
    ui().answerConfirmation(false)
    await settle()
    expect(ui()).toMatchObject({ settingsOpen: true, settingsSection: 'tasks' })
    expect(drafts().draft?.lensId).toBe('lens-a')

    ui().closeSettings()
    ui().answerConfirmation('discard')
    await settle()
    expect(ui().settingsOpen).toBe(false)
    expect(drafts().draft).toBeNull()
  })

  it('closeSettings → Save saves, then closes', async () => {
    ui().closeSettings()
    ui().answerConfirmation(true)
    await vi.waitFor(() => expect(ui().settingsOpen).toBe(false))
    expect(lens('lens-a')!.predicate.statusIds).toEqual([3])
  })

  it('another section asks; a part of the same section, or no section, does not', async () => {
    ui().setSettingsSection('eisenhower')
    expect(ui().confirmPrompts).toHaveLength(0)
    ui().openSettings()
    expect(ui().confirmPrompts).toHaveLength(0)

    ui().setSettingsSection('database')
    expect(ui().confirmPrompts).toHaveLength(1)
    expect(ui().settingsSection).toBe('tasks')
    ui().answerConfirmation(false)
    await settle()
    expect(ui().settingsSection).toBe('tasks')

    // A deep link to another section while open (the storage pill's): asked too.
    ui().openSettings('backups')
    expect(ui().confirmPrompts).toHaveLength(1)
    ui().answerConfirmation('discard')
    await settle()
    expect(ui().settingsSection).toBe('database')
  })

  it('hideSettings (the phone width) closes at once and keeps the draft; closed, nothing asks', () => {
    ui().hideSettings()
    expect(ui().settingsOpen).toBe(false)
    expect(ui().confirmPrompts).toHaveLength(0)
    expect(drafts().draft?.lensId).toBe('lens-a')
    ui().closeSettings()
    ui().setSettingsSection('about')
    expect(ui().confirmPrompts).toHaveLength(0)
  })

  it('askConfirmation stays yes / no: a discard label is dropped', async () => {
    const asked = ui().askConfirmation({ title: 'T', message: 'M', confirmLabel: 'OK', discardLabel: 'Nope' })
    expect(prompt()?.discardLabel).toBeUndefined()
    ui().answerConfirmation(true)
    expect(await asked).toBe(true)
  })
})
