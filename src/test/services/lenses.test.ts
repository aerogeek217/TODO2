import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { SETTING_KEYS } from '../../data/setting-keys'
import { emptyPredicate } from '../../models/filter-predicate'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { cycleLens, deleteLens, toggleLensLift } from '../../services/lenses'
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetDb } from '../helpers'

const T0 = new Date('2026-09-01T09:00:00.000Z')
const layout = (name: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({ name, columns: [], createdAt: T0, modifiedAt: T0 })

async function storedPick(): Promise<string | undefined> {
  return (await db.settings.get(SETTING_KEYS.activeLensId))?.value
}

const settings = () => useSettingsStore.getState()

let ids: number[] = []

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  ids = [await layoutRepository.insert(layout('Default')), await layoutRepository.insert(layout('Planning'))]
  await layoutRepository.setActiveId(ids[0]!)
  await useWorkspaceStore.getState().init()
  await settings().setLenses([
    { id: 'lens-a', name: 'This month', predicate: emptyPredicate() },
    { id: 'lens-b', name: 'Fresh', predicate: emptyPredicate() },
    { id: 'lens-c', name: 'Unused', predicate: emptyPredicate() },
  ], 'Seed')
  await settings().setActiveLens('lens-a')
  useUndoStore.getState().clear()
})

describe('deleteLens', () => {
  it('the picked lens: no prompt, the top bar goes to No lens; one undo step brings the lens and the pick back, redo takes both again', async () => {
    expect(await deleteLens('lens-a')).toBe(true)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(settings().lenses.map((l) => l.id)).toEqual(['lens-b', 'lens-c'])
    expect(settings().activeLensId).toBeNull()
    expect(await storedPick()).toBeUndefined()
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().undoStack[0]?.description).toBe('Deleted lens “This month”')

    await useUndoStore.getState().undo()
    expect(settings().lenses.map((l) => l.id)).toEqual(['lens-a', 'lens-b', 'lens-c'])
    expect(settings().activeLensId).toBe('lens-a')
    expect(await storedPick()).toBe('lens-a')

    await useUndoStore.getState().redo()
    expect(settings().lenses.map((l) => l.id)).toEqual(['lens-b', 'lens-c'])
    expect(settings().activeLensId).toBeNull()
    expect(await storedPick()).toBeUndefined()
  })

  it('a lens not picked goes without asking and leaves the pick alone', async () => {
    expect(await deleteLens('lens-c')).toBe(true)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(settings().lenses.map((l) => l.id)).toEqual(['lens-a', 'lens-b'])
    expect(settings().activeLensId).toBe('lens-a')
    await useUndoStore.getState().undo()
    expect(settings().lenses.map((l) => l.id)).toEqual(['lens-a', 'lens-b', 'lens-c'])
    expect(settings().activeLensId).toBe('lens-a')
  })

  it('an unknown lens deletes nothing', async () => {
    expect(await deleteLens('lens-z')).toBe(false)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })
})

describe('the keyboard actions', () => {
  it('Cycle lens: the next lens in Settings’ order, then No lens, then the first again — the lens back on, saved at once', async () => {
    useUIStore.getState().setLensLifted(true)
    cycleLens()
    await vi.waitFor(() => expect(settings().activeLensId).toBe('lens-b'))
    expect(useUIStore.getState().lensLifted).toBe(false)
    await vi.waitFor(async () => expect(await storedPick()).toBe('lens-b'))
    cycleLens()
    await vi.waitFor(() => expect(settings().activeLensId).toBe('lens-c'))
    cycleLens()
    await vi.waitFor(() => expect(settings().activeLensId).toBeNull())
    cycleLens()
    await vi.waitFor(() => expect(settings().activeLensId).toBe('lens-a'))
    // A pick is no edit: no undo step, the layout stays saved.
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })

  it('Cycle lens without any lens says where to make one', () => {
    useSettingsStore.setState({ lenses: [] })
    cycleLens()
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'No lenses yet — add one in Settings › Tasks › Lenses.', notice: true })
  })

  it('Lift lens toggles the lift; without a lens it says so', async () => {
    toggleLensLift()
    expect(useUIStore.getState().lensLifted).toBe(true)
    toggleLensLift()
    expect(useUIStore.getState().lensLifted).toBe(false)
    await settings().setActiveLens(null)
    toggleLensLift()
    expect(useUIStore.getState().lensLifted).toBe(false)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'No lens to lift.' })
  })
})

describe('a layout switch', () => {
  it('keeps the lens and its lift', async () => {
    useUIStore.getState().setLensLifted(true)
    await useWorkspaceStore.getState().load(ids[1]!)
    expect(useWorkspaceStore.getState().activeLayoutId).toBe(ids[1])
    expect(settings().activeLensId).toBe('lens-a')
    expect(useUIStore.getState().lensLifted).toBe(true)
    expect(useWorkspaceStore.getState().isDirty).toBe(false)
  })
})
