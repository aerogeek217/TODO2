import { describe, it, expect, beforeEach } from 'vitest'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import type { LayoutTab, PersistedWorkspaceLayout } from '../../models/workspace-layout'
import type { PersistedListDefinition } from '../../models/list-definition'
import { emptyPredicate } from '../../models/filter-predicate'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'

const AT = new Date(2026, 0, 1)

function layout(id: number, tabs: LayoutTab[]): PersistedWorkspaceLayout {
  return { id, sortOrder: 0, name: `L${id}`, createdAt: AT, modifiedAt: AT, columns: [{ id: `c${id}`, weight: 1, cells: [{ id: `k${id}`, weight: 1, tabs }] }] }
}

const list = (id: number): PersistedListDefinition => ({
  id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() },
})

const open = layout(1, [{ id: 'a', kind: 'lens', config: { listDefinitionId: 7 } }, { id: 'e', kind: 'eisenhower', config: {} }])
const other = layout(2, [{ id: 'f', kind: 'eisenhower', config: {} }])

beforeEach(() => {
  useWorkspaceStore.setState({ layouts: [open, other], working: open, saved: open })
  useListDefinitionStore.setState({ listDefinitions: [list(7), list(8)] })
})

describe('countListWidgets', () => {
  it('counts list tabs on the list, and every Eisenhower tab (all layouts) when it is the Eisenhower’s list', () => {
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
