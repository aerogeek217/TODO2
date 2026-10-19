import { describe, it, expect, beforeEach } from 'vitest'
import { countListWidgets, listsLosingLastWidgetToSource } from '../../hooks/use-list-widget-count'
import type { LayoutTab, PersistedWorkspaceLayout } from '../../models/workspace-layout'
import type { PersistedListDefinition } from '../../models/list-definition'
import { emptyPredicate } from '../../models/filter-predicate'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useListDraftStore } from '../../stores/list-draft-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

const AT = new Date(2026, 0, 1)

function layout(id: number, tabs: LayoutTab[]): PersistedWorkspaceLayout {
  return { id, name: `L${id}`, createdAt: AT, modifiedAt: AT, columns: [{ id: `c${id}`, weight: 1, cells: [{ id: `k${id}`, weight: 1, tabs }] }] }
}

const list = (id: number): PersistedListDefinition => ({
  id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() },
})

const open = layout(1, [{ id: 'a', kind: 'lens', config: { listDefinitionId: 7 } }, { id: 'e', kind: 'eisenhower', config: {} }])
const other = layout(2, [{ id: 'f', kind: 'eisenhower', config: {} }])

beforeEach(() => {
  useWorkspaceStore.setState({ layouts: [open, other], working: open, saved: open })
  useListDefinitionStore.setState({ listDefinitions: [list(7), list(8)] })
  useListDraftStore.setState({ drafts: {} })
})

describe('countListWidgets', () => {
  it('counts list tabs on the list, and every Eisenhower tab (all layouts) while the Eisenhower source is it', () => {
    const state = useWorkspaceStore.getState()
    expect(countListWidgets(state, 7, undefined, null)).toBe(1)
    expect(countListWidgets(state, 7, undefined, 7)).toBe(3)
    expect(countListWidgets(state, 8, undefined, 8)).toBe(2)
    expect(countListWidgets(state, 7, new Set(['a', 'e']), 7)).toBe(1)
    // By default the source as it is now.
    useSettingsStore.setState({ eisenhowerListId: 8 })
    expect(countListWidgets(state, 8)).toBe(2)
  })
})

describe('listsLosingLastWidgetToSource', () => {
  it('names the source list when it has unsaved edits and only Eisenhower tabs show it', () => {
    useSettingsStore.setState({ eisenhowerListId: 8 })
    expect(listsLosingLastWidgetToSource(null)).toEqual([])
    useListDraftStore.setState({ drafts: { 8: { ...list(8), name: 'Edited' } } })
    expect(listsLosingLastWidgetToSource(null)).toEqual([8])
    expect(listsLosingLastWidgetToSource(7)).toEqual([8])
    expect(listsLosingLastWidgetToSource(8)).toEqual([])
  })

  it('nothing to ask when a list tab still shows it, or the source is all tasks', () => {
    useSettingsStore.setState({ eisenhowerListId: 7 })
    useListDraftStore.setState({ drafts: { 7: { ...list(7), name: 'Edited' } } })
    expect(listsLosingLastWidgetToSource(null)).toEqual([])
    useSettingsStore.setState({ eisenhowerListId: null })
    expect(listsLosingLastWidgetToSource(8)).toEqual([])
  })

  it('nothing to ask when no widget shows the source list now (no Eisenhower tab anywhere)', () => {
    const lists = layout(3, [{ id: 'b', kind: 'lens', config: { listDefinitionId: 7 } }])
    useWorkspaceStore.setState({ layouts: [lists], working: lists, saved: lists })
    useSettingsStore.setState({ eisenhowerListId: 8 })
    useListDraftStore.setState({ drafts: { 8: { ...list(8), name: 'Edited' } } })
    expect(listsLosingLastWidgetToSource(null)).toEqual([])
  })
})
