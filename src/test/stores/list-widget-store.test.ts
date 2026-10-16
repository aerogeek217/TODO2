import { describe, it, expect } from 'vitest'
import { useListWidgetStore } from '../../stores/list-widget-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'

const AT = new Date('2026-10-01T09:00:00.000Z')

function layout(id: number, tabIds: string[]): PersistedWorkspaceLayout {
  return {
    id, name: `L${id}`, createdAt: AT, modifiedAt: AT,
    columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: tabIds.map((t) => createTab('lens', t, { listDefinitionId: 1 })) }] }],
  }
}

describe('list widget state of closed tabs', () => {
  it('a write drops the picks and collapsed groups of tabs in no layout; open and saved layouts keep theirs', () => {
    // Layout 1 is open, its working copy has a new tab; layout 2 is another saved layout.
    const saved = layout(1, ['saved-tab'])
    useWorkspaceStore.setState({ layouts: [saved, layout(2, ['other-layout-tab'])], working: layout(1, ['open-tab', 'saved-tab']), saved })
    useListWidgetStore.setState({
      picks: { 'gone-tab': [1], 'other-layout-tab': [2], 'saved-tab': [3] },
      collapsed: { 'gone-tab': ['a'], 'other-layout-tab': ['b'] },
    })

    useListWidgetStore.getState().setPicks('open-tab', [4])
    expect(useListWidgetStore.getState().picks).toEqual({ 'other-layout-tab': [2], 'saved-tab': [3], 'open-tab': [4] })

    useListWidgetStore.getState().toggleGroup('open-tab', 'today')
    expect(useListWidgetStore.getState().collapsed).toEqual({ 'other-layout-tab': ['b'], 'open-tab': ['today'] })
  })

  it('drops nothing before the workspace is open', () => {
    useListWidgetStore.setState({ picks: { 'tab-a': [1] } })
    useListWidgetStore.getState().setPicks('tab-b', [2])
    expect(useListWidgetStore.getState().picks).toEqual({ 'tab-a': [1], 'tab-b': [2] })
  })
})
