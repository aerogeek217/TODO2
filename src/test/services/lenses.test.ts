import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { emptyPredicate } from '../../models/filter-predicate'
import type { PersistedWorkspaceLayout, WorkspaceLayout } from '../../models/workspace-layout'
import { cycleLens, deleteLens, lensUserNames, toggleLensLift } from '../../services/lenses'
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetDb } from '../helpers'

const T0 = new Date('2026-09-01T09:00:00.000Z')
const layout = (name: string, lensId?: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({
  name, columns: [], createdAt: T0, modifiedAt: T0, ...(lensId ? { lensId } : {}),
})

async function stored(id: number): Promise<PersistedWorkspaceLayout> {
  return (await db.layouts.get(id)) as PersistedWorkspaceLayout
}

let ids: number[] = []

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  ids = [
    await layoutRepository.insert(layout('Default', 'lens-a')),
    await layoutRepository.insert(layout('Planning', 'lens-a')),
    await layoutRepository.insert(layout('Review', 'lens-b')),
  ]
  await layoutRepository.setActiveId(ids[0]!)
  await useWorkspaceStore.getState().init()
  await useSettingsStore.getState().setLenses([
    { id: 'lens-a', name: 'This month', predicate: emptyPredicate() },
    { id: 'lens-b', name: 'Fresh', predicate: emptyPredicate() },
    { id: 'lens-c', name: 'Unused', predicate: emptyPredicate() },
  ], 'Seed')
  useUndoStore.getState().clear()
})

describe('deleteLens', () => {
  it('names the layouts that use a lens', () => {
    expect(lensUserNames('lens-a')).toEqual(['Default', 'Planning'])
    expect(lensUserNames('lens-c')).toEqual([])
  })

  it('asks first when layouts use it; No keeps the lens and the picks', async () => {
    const done = deleteLens('lens-a')
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    expect(useUIStore.getState().confirmPrompts[0]).toMatchObject({
      title: 'Delete lens “This month”?',
      message: 'Used by “Default” and “Planning” — they’ll show every task.',
      danger: true,
    })
    useUIStore.getState().answerConfirmation(false)
    expect(await done).toBe(false)
    expect(useSettingsStore.getState().lenses).toHaveLength(3)
    expect((await stored(ids[1]!)).lensId).toBe('lens-a')
  })

  it('deleted: its layouts go to No lens; one undo step brings the lens and the picks back', async () => {
    const done = deleteLens('lens-a')
    await vi.waitFor(() => expect(useUIStore.getState().confirmPrompts).toHaveLength(1))
    useUIStore.getState().answerConfirmation(true)
    expect(await done).toBe(true)
    expect(useSettingsStore.getState().lenses.map((l) => l.id)).toEqual(['lens-b', 'lens-c'])
    expect(useWorkspaceStore.getState().working?.lensId).toBeUndefined()
    expect((await stored(ids[0]!)).lensId).toBeUndefined()
    expect((await stored(ids[1]!)).lensId).toBeUndefined()
    expect((await stored(ids[2]!)).lensId).toBe('lens-b')
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().undoStack[0]?.description).toBe('Deleted lens “This month”')

    await useUndoStore.getState().undo()
    expect(useSettingsStore.getState().lenses.map((l) => l.id)).toEqual(['lens-a', 'lens-b', 'lens-c'])
    expect(useWorkspaceStore.getState().working?.lensId).toBe('lens-a')
    expect((await stored(ids[1]!)).lensId).toBe('lens-a')
  })

  it('a lens no layout uses goes without asking', async () => {
    expect(await deleteLens('lens-c')).toBe(true)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(useSettingsStore.getState().lenses.map((l) => l.id)).toEqual(['lens-a', 'lens-b'])
  })
})

describe('the keyboard actions', () => {
  it('Cycle lens: the next lens in Settings’ order, then No lens, then the first again — the lens back on', async () => {
    const ws = () => useWorkspaceStore.getState()
    useUIStore.getState().setLensLifted(true)
    cycleLens()
    await vi.waitFor(() => expect(ws().working?.lensId).toBe('lens-b'))
    expect(useUIStore.getState().lensLifted).toBe(false)
    cycleLens()
    await vi.waitFor(() => expect(ws().working?.lensId).toBe('lens-c'))
    cycleLens()
    await vi.waitFor(() => expect(ws().working?.lensId).toBeUndefined())
    cycleLens()
    await vi.waitFor(() => expect(ws().working?.lensId).toBe('lens-a'))
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
    useWorkspaceStore.getState().setLens(null)
    toggleLensLift()
    expect(useUIStore.getState().lensLifted).toBe(false)
    expect(useUndoStore.getState().snackbar).toMatchObject({ description: 'This layout has no lens to lift.' })
  })
})
