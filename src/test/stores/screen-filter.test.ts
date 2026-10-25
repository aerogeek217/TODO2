import { describe, it, expect, beforeEach } from 'vitest'
import { layoutRepository } from '../../data/layout-repository'
import { emptyPredicate } from '../../models/filter-predicate'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { useFilterStore } from '../../stores/filter-store'
import { currentAppliedLens, currentScreenFilter } from '../../stores/screen-filter'
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetDb } from '../helpers'

const T0 = new Date('2026-09-01T09:00:00.000Z')
const layout = (name: string, lensId?: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({
  name, columns: [], createdAt: T0, modifiedAt: T0, ...(lensId ? { lensId } : {}),
})
const LENS = { id: 'lens-a', name: 'Has a person', predicate: { ...emptyPredicate(), personIds: [0], negate: { personIds: true as const } } }

let ids: number[] = []

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  ids = [await layoutRepository.insert(layout('Default', 'lens-a')), await layoutRepository.insert(layout('Planning'))]
  await layoutRepository.setActiveId(ids[0]!)
  await useWorkspaceStore.getState().init()
  useSettingsStore.setState({ lenses: [LENS] })
})

describe('the screen filter with the lens', () => {
  it('the open layout’s lens composes under the chips', () => {
    useFilterStore.getState().setSearchText('budget')
    const screen = currentScreenFilter()
    expect(screen.searchText).toBe('budget')
    expect(screen.lens?.personIds).toEqual(new Set([0]))
    expect(screen.lens?.negate).toEqual({ personIds: true })
    // The same object while nothing changed (stores compare by reference).
    expect(currentScreenFilter()).toBe(screen)
  })

  it('no lens: the chips alone — none picked, a lens deleted since, or lifted', () => {
    useUIStore.getState().setLensLifted(true)
    expect(currentAppliedLens()).toBeUndefined()
    expect(currentScreenFilter()).toBe(useFilterStore.getState().filters)
    useUIStore.getState().setLensLifted(false)
    expect(currentAppliedLens()).toBe(LENS)
    useSettingsStore.setState({ lenses: [] })
    expect(currentAppliedLens()).toBeUndefined()
  })

  it('a layout switch puts a lifted lens back', async () => {
    useUIStore.getState().setLensLifted(true)
    await useWorkspaceStore.getState().load(ids[1]!)
    expect(useUIStore.getState().lensLifted).toBe(false)
    expect(currentAppliedLens()).toBeUndefined()
    await useWorkspaceStore.getState().load(ids[0]!)
    expect(currentAppliedLens()).toBe(LENS)
  })

  it('Clear all clears the chips only, never the lens', () => {
    useFilterStore.getState().setSearchText('budget')
    useFilterStore.getState().clearAll()
    expect(currentScreenFilter().searchText).toBe('')
    expect(currentScreenFilter().lens).toBeDefined()
  })
})
