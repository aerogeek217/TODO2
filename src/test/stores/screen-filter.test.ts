import { describe, it, expect, beforeEach } from 'vitest'
import { layoutRepository } from '../../data/layout-repository'
import { emptyPredicate } from '../../models/filter-predicate'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { useFilterStore } from '../../stores/filter-store'
import { currentAppliedLens, currentPickedLens, currentScreenFilter } from '../../stores/screen-filter'
import { useSettingsStore } from '../../stores/settings-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetDb } from '../helpers'

const T0 = new Date('2026-09-01T09:00:00.000Z')
const layout = (name: string): Omit<WorkspaceLayout, 'id' | 'sortOrder'> => ({ name, columns: [], createdAt: T0, modifiedAt: T0 })
const LENS = { id: 'lens-a', name: 'Has a person', predicate: { ...emptyPredicate(), personIds: [0], negate: { personIds: true as const } } }

let ids: number[] = []

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  ids = [await layoutRepository.insert(layout('Default')), await layoutRepository.insert(layout('Planning'))]
  await layoutRepository.setActiveId(ids[0]!)
  await useWorkspaceStore.getState().init()
  useSettingsStore.setState({ lenses: [LENS], activeLensId: 'lens-a' })
})

describe('the screen filter with the lens', () => {
  it('the top bar’s lens composes under the chips', () => {
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
    useSettingsStore.setState({ activeLensId: null })
    expect(currentAppliedLens()).toBeUndefined()
    useSettingsStore.setState({ activeLensId: 'lens-a', lenses: [] })
    expect(currentAppliedLens()).toBeUndefined()
  })

  it('a layout switch keeps the lens, and a lifted lens stays lifted', async () => {
    await useWorkspaceStore.getState().load(ids[1]!)
    expect(currentAppliedLens()).toBe(LENS)
    useUIStore.getState().setLensLifted(true)
    await useWorkspaceStore.getState().load(ids[0]!)
    expect(useUIStore.getState().lensLifted).toBe(true)
    expect(currentAppliedLens()).toBeUndefined()
    expect(currentPickedLens()).toBe(LENS)
  })

  it('Clear all clears the chips only, never the lens', () => {
    useFilterStore.getState().setSearchText('budget')
    useFilterStore.getState().clearAll()
    expect(currentScreenFilter().searchText).toBe('')
    expect(currentScreenFilter().lens).toBeDefined()
  })
})
