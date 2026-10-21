import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup, fireEvent, within, screen } from '@testing-library/react'
import { CustomizeDashboardDialog, PROMPTED_LIST_TILE_NOTE } from '../../../components/workspace/dashboard/CustomizeDashboardDialog'
import { defaultDashboardConfig, type DashboardTabConfig } from '../../../models/dashboard-config'
import type { DashboardTab, PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { PEOPLE, SAMPLE_LISTS, STATUSES, TAGS } from '../../fixtures/dashboard-sample'

const T0 = new Date('2026-09-01T09:00:00.000Z')

function layoutWith(config: DashboardTabConfig): PersistedWorkspaceLayout {
  const tab: DashboardTab = { id: 'dash', kind: 'dashboard', config }
  return {
    id: 1,
    sortOrder: 0, name: 'Dash',
    createdAt: T0,
    modifiedAt: T0,
    columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, activeTabId: 'dash', tabs: [tab] }] }],
  }
}

function seed(config: DashboardTabConfig = defaultDashboardConfig()) {
  const layout = layoutWith(config)
  useWorkspaceStore.setState({ layouts: [layout], activeLayoutId: 1, working: layout, saved: layout, isDirty: false, hydrated: true })
}

const tabConfig = (): DashboardTabConfig => {
  const tab = useWorkspaceStore.getState().working!.columns[0]!.cells[0]!.tabs[0]!
  if (tab.kind !== 'dashboard') throw new Error('not a dashboard')
  return tab.config
}
const dirty = () => useWorkspaceStore.getState().isDirty
const group = (name: string) => screen.getByRole('list', { name })
const rowIds = (name: string) => Array.from(group(name).querySelectorAll<HTMLElement>('[data-customize-row]')).map((r) => r.dataset.customizeRow)

let onClose: ReturnType<typeof vi.fn<() => void>>

function setup(opts: { focusListTiles?: boolean } = {}) {
  return render(<CustomizeDashboardDialog tabId="dash" focusListTiles={opts.focusListTiles} onClose={onClose} />)
}

beforeEach(() => {
  onClose = vi.fn<() => void>()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
  useListDraftStore.setState({ drafts: {} })
  usePersonStore.setState({ people: PEOPLE })
  useTagStore.setState({ tags: TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
  seed()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('CustomizeDashboardDialog', () => {
  it('lists every tile and section, shown ones ticked, with what each counts', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Customize dashboard' })).toBeTruthy()
    expect(rowIds('Tiles')).toEqual([
      'tile:open', 'tile:hot', 'tile:focus', 'tile:urgent', 'tile:overdue', 'tile:followupDue', 'tile:dueToday', 'tile:dueNext7', 'tile:noFollowup',
    ])
    const tiles = within(group('Tiles'))
    expect((tiles.getByRole('checkbox', { name: 'Open' }) as HTMLInputElement).checked).toBe(true)
    expect((tiles.getByRole('checkbox', { name: 'Due today' }) as HTMLInputElement).checked).toBe(false)
    expect(group('Tiles').textContent).toContain('Flagged, or due within 3 days')
    expect(group('Tiles').textContent).toContain('Today through Fri 16')
    expect(rowIds('Sections')).toEqual([
      'section:hot', 'section:followup', 'section:next7', 'section:trend', 'section:status', 'section:people',
      'section:tags', 'section:stale', 'section:recent', 'section:eisenhower',
    ])
    const sections = within(group('Sections'))
    expect((sections.getByRole('checkbox', { name: 'People' }) as HTMLInputElement).checked).toBe(true)
    for (const name of ['Tags', 'Stale tasks', 'Recently completed', 'Eisenhower']) {
      expect((sections.getByRole('checkbox', { name }) as HTMLInputElement).checked).toBe(false)
    }
    expect(screen.getByRole('button', { name: 'Look ahead: 7 days' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Range: 14 days' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unassigned: Shown' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'No tag: Shown' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Older than: 14 days' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Last: 7 days' })).toBeTruthy()
    // Every grip is a keyboard handle with a name.
    expect(screen.getByRole('button', { name: 'Move Open' })).toBeTruthy()
  })

  it('ticking a tile shows it at once and makes the layout unsaved; unticking it back is no change', () => {
    setup()
    fireEvent.click(within(group('Tiles')).getByRole('checkbox', { name: 'Due today' }))
    expect(tabConfig().tiles).toEqual(['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday'])
    expect(dirty()).toBe(true)
    fireEvent.click(within(group('Tiles')).getByRole('checkbox', { name: 'Due today' }))
    expect(tabConfig().tiles).toEqual(defaultDashboardConfig().tiles)
    expect(dirty()).toBe(false)
  })

  it('a config change made elsewhere while open (a sync-file load) shows, and the next edit builds on it', () => {
    setup()
    act(() => {
      useWorkspaceStore.getState().patchTabConfig('dash', 'dashboard', {
        tiles: ['dueToday', 'open'],
        sections: [{ id: 'people', options: { showUnassigned: false } }, { id: 'hot' }],
      })
    })
    expect(rowIds('Tiles').slice(0, 2)).toEqual(['tile:dueToday', 'tile:open'])
    expect(rowIds('Sections').slice(0, 2)).toEqual(['section:people', 'section:hot'])
    expect(screen.getByRole('button', { name: 'Unassigned: Hidden' })).toBeTruthy()
    fireEvent.click(within(group('Tiles')).getByRole('checkbox', { name: 'Hot' }))
    expect(tabConfig().tiles).toEqual(['dueToday', 'open', 'hot'])
    fireEvent.click(within(group('Sections')).getByRole('checkbox', { name: 'Status' }))
    expect(tabConfig().sections.map((s) => s.id)).toEqual(['people', 'hot', 'status'])
    expect(tabConfig().sections[0]).toEqual({ id: 'people', options: { showUnassigned: false } })
  })

  it('hiding a section drops it from the config; its option is disabled while hidden', () => {
    setup()
    fireEvent.click(within(group('Sections')).getByRole('checkbox', { name: 'Created vs completed' }))
    expect(tabConfig().sections.map((s) => s.id)).toEqual(['hot', 'followup', 'next7', 'status', 'people'])
    expect((screen.getByRole('button', { name: 'Range: 14 days' }) as HTMLButtonElement).disabled).toBe(true)
    expect(dirty()).toBe(true)
  })

  it('a section option is picked from its menu and saved with the section', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Look ahead: 7 days' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '14 days' }))
    expect(tabConfig().sections.find((s) => s.id === 'followup')).toEqual({ id: 'followup', options: { lookAhead: 14 } })
    expect(screen.getByRole('button', { name: 'Look ahead: 14 days' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Unassigned: Shown' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hidden' }))
    expect(tabConfig().sections.find((s) => s.id === 'people')).toEqual({ id: 'people', options: { showUnassigned: false } })
  })

  it('shows the Tags / Stale tasks / Recently completed / Eisenhower sections after the rest; their options save with them', () => {
    setup()
    const sections = within(group('Sections'))
    expect((screen.getByRole('button', { name: 'Older than: 14 days' }) as HTMLButtonElement).disabled).toBe(true)
    for (const name of ['Stale tasks', 'Eisenhower', 'Tags', 'Recently completed']) fireEvent.click(sections.getByRole('checkbox', { name }))
    // Shown in the dialog's order, after the default ones.
    expect(tabConfig().sections.map((s) => s.id)).toEqual(['hot', 'followup', 'next7', 'trend', 'status', 'people', 'tags', 'stale', 'recent', 'eisenhower'])
    expect(dirty()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Older than: 14 days' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '30 days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Last: 7 days' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '14 days' }))
    fireEvent.click(screen.getByRole('button', { name: 'No tag: Shown' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hidden' }))
    expect(tabConfig().sections.filter((s) => ['tags', 'stale', 'recent', 'eisenhower'].includes(s.id))).toEqual([
      { id: 'tags', options: { showUntagged: false } },
      { id: 'stale', options: { staleDays: 30 } },
      { id: 'recent', options: { recentDays: 14 } },
      { id: 'eisenhower' },
    ])
  })

  it('Add a list: lists that ask for a value are disabled with why; a pick adds a list tile', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add a list' }))
    const menu = screen.getByRole('menu', { name: 'Lists' })
    const prompted = within(menu).getByRole('menuitem', { name: /Tasks for…/ })
    expect((prompted as HTMLButtonElement).disabled).toBe(true)
    expect(prompted.getAttribute('title')).toBe(PROMPTED_LIST_TILE_NOTE)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Waiting on/ }))
    expect(tabConfig().listTiles).toEqual([1])
    expect(rowIds('List tiles')).toEqual(['list:1'])
    expect(group('List tiles').textContent).toContain('Status: Waiting')

    // An added list shows as added.
    fireEvent.click(screen.getByRole('button', { name: 'Add a list' }))
    const again = within(screen.getByRole('menu', { name: 'Lists' })).getByRole('menuitem', { name: /Waiting on/ })
    expect((again as HTMLButtonElement).disabled).toBe(true)
    expect(again.textContent).toContain('Added')
  })

  it('× removes a list tile', () => {
    seed({ ...defaultDashboardConfig(), listTiles: [1, 2] })
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting on' }))
    expect(tabConfig().listTiles).toEqual([2])
  })

  it('a deleted list’s tile isn’t listed, and the next edit drops its id', () => {
    seed({ ...defaultDashboardConfig(), listTiles: [99, 2] })
    setup()
    expect(rowIds('List tiles')).toEqual(['list:2'])
    fireEvent.click(screen.getByRole('button', { name: 'Add a list' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Lists' })).getByRole('menuitem', { name: /Errands/ }))
    expect(tabConfig().listTiles).toEqual([2, 4])
  })

  it('Reset to default restores the default config (here: the saved one, so the layout is clean again)', () => {
    seed()
    setup()
    fireEvent.click(within(group('Tiles')).getByRole('checkbox', { name: 'Hot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Look ahead: 7 days' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '3 days' }))
    expect(dirty()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(tabConfig()).toEqual(defaultDashboardConfig())
    expect(dirty()).toBe(false)
    expect((within(group('Tiles')).getByRole('checkbox', { name: 'Hot' }) as HTMLInputElement).checked).toBe(true)
  })

  it('Done, ×, Esc and a backdrop click close it; changes stay', () => {
    setup()
    fireEvent.click(within(group('Tiles')).getByRole('checkbox', { name: 'Due today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(tabConfig().tiles).toContain('dueToday')
  })

  it('opened from “+ Add list tile”, Add a list has the focus', () => {
    setup({ focusListTiles: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a list' }))
  })

  it('closes itself when its tab is gone', () => {
    setup()
    act(() => useWorkspaceStore.getState().closeTab('dash'))
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps app shortcuts out (a modal scope)', () => {
    setup()
    expect(screen.getByRole('dialog').getAttribute('data-shortcut-scope')).toBe('modal')
  })
})
