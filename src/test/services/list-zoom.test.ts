import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LensTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { listTabZoom, setListTabZoom, stepListTabZoom } from '../../services/list-zoom'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetDb } from '../helpers'
import { single } from '../helpers/layout-builders'

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

async function open(): Promise<number> {
  const layout: Omit<WorkspaceLayout, 'id'> = {
    sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0,
    ...single({ id: 'k', activeTabId: 'l1', tabs: [createTab('lens', 'l1'), createTab('notes', 'n1')] }),
  }
  const id = await layoutRepository.insert(layout)
  await layoutRepository.setActiveId(id)
  await ws().init()
  return id
}

async function storedTab(id: number): Promise<LensTab> {
  const row = await db.layouts.get(id)
  return row!.cells[0]!.tabs[0] as LensTab
}

beforeEach(async () => {
  await resetDb()
})

describe('a list tab’s zoom (D25 C + I1)', () => {
  it('without its own, a tab shows the Settings default', () => {
    useSettingsStore.setState({ listZoom: 'lines' })
    expect(listTabZoom({ id: 't' })).toBe('lines')
    expect(listTabZoom({ id: 't', viewState: { zoom: 'stacked' } })).toBe('stacked')
  })

  it('Auto: the level the widget shows (by its width), Rows before it is measured; the tab’s own pick wins', () => {
    useSettingsStore.setState({ listZoom: 'auto' })
    expect(listTabZoom({ id: 't' })).toBe('rows')
    useListWidgetStore.getState().setShownZoom('t', 'stacked')
    expect(listTabZoom({ id: 't' })).toBe('stacked')
    expect(listTabZoom({ id: 't', viewState: { zoom: 'lines' } })).toBe('lines')
    useListWidgetStore.getState().setShownZoom('t', null)
    expect(useListWidgetStore.getState().zoom).toEqual({})
  })

  it('steps from the level shown: Auto showing Stacked zooms out to Rows, saved as the tab’s own', async () => {
    useSettingsStore.setState({ listZoom: 'auto' })
    const id = await open()
    useListWidgetStore.getState().setShownZoom('l1', 'stacked')
    await stepListTabZoom('l1', 'in')
    expect((await storedTab(id)).viewState?.zoom).toBeUndefined()
    await stepListTabZoom('l1', 'out')
    expect((await storedTab(id)).viewState?.zoom).toBe('rows')
  })

  it('is view state: saved at once on the stored layout, never an unsaved edit', async () => {
    const id = await open()
    await setListTabZoom('l1', 'stacked')
    expect(ws().isDirty).toBe(false)
    expect((await storedTab(id)).viewState).toEqual({ zoom: 'stacked' })
  })

  it('steps from the tab’s level (the default when it has none), clamped at the ends; a non-list tab is left alone', async () => {
    useSettingsStore.setState({ listZoom: 'rows' })
    const id = await open()
    await stepListTabZoom('l1', 'out')
    expect((await storedTab(id)).viewState?.zoom).toBe('lines')
    await stepListTabZoom('l1', 'out')
    expect((await storedTab(id)).viewState?.zoom).toBe('lines')
    await stepListTabZoom('n1', 'in')
    expect(ws().isDirty).toBe(false)
  })

  it('every control steps through it: the tab menu’s − / + and the palette step the tab they show', async () => {
    useSettingsStore.setState({ listZoom: 'rows' })
    const id = await open()
    // The tab as a control shows it: stepped from its own level.
    await stepListTabZoom({ id: 'l1', viewState: { zoom: 'stacked' } }, 'out')
    expect((await storedTab(id)).viewState?.zoom).toBe('rows')
    await stepListTabZoom({ id: 'l1' }, 'in')
    expect((await storedTab(id)).viewState?.zoom).toBe('stacked')
    // At the end: nothing written.
    await stepListTabZoom({ id: 'l1', viewState: { zoom: 'stacked' } }, 'in')
    expect((await storedTab(id)).viewState?.zoom).toBe('stacked')
    expect(ws().isDirty).toBe(false)
  })
})
