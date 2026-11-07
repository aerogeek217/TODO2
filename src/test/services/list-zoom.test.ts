import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { layoutRepository } from '../../data/layout-repository'
import { createTab, type LensTab, type WorkspaceLayout } from '../../models/workspace-layout'
import { listTabZoom, setListTabZoom, stepListTabZoom } from '../../services/list-zoom'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { resetDb } from '../helpers'
import { rowOf } from '../helpers/layout-builders'

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

async function open(): Promise<number> {
  const layout: Omit<WorkspaceLayout, 'id'> = {
    sortOrder: 0, name: 'Daily', createdAt: T0, modifiedAt: T0,
    columns: [{ id: 'A', weight: 1, rows: [rowOf({ id: 'k', weight: 1, activeTabId: 'l1', tabs: [createTab('lens', 'l1'), createTab('notes', 'n1')] })] }],
  }
  const id = await layoutRepository.insert(layout)
  await layoutRepository.setActiveId(id)
  await ws().init()
  return id
}

async function storedTab(id: number): Promise<LensTab> {
  const row = await db.layouts.get(id)
  return row!.columns[0]!.rows[0]!.cells[0]!.tabs[0] as LensTab
}

beforeEach(async () => {
  await resetDb()
})

describe('a list tab’s zoom (D25 C + I1)', () => {
  it('without its own, a tab shows the Settings default', () => {
    useSettingsStore.setState({ listZoom: 'lines' })
    expect(listTabZoom({})).toBe('lines')
    expect(listTabZoom({ viewState: { zoom: 'strips' } })).toBe('strips')
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
    await stepListTabZoom('l1', 'out')
    expect((await storedTab(id)).viewState?.zoom).toBe('strips')
    await stepListTabZoom('n1', 'in')
    expect(ws().isDirty).toBe(false)
  })
})
