import { describe, it, expect, beforeEach } from 'vitest'
import { countListWidgets } from '../../hooks/use-list-widget-count'
import type { LayoutTab, PersistedWorkspaceLayout } from '../../models/workspace-layout'
import type { PersistedListDefinition } from '../../models/list-definition'
import { emptyPredicate } from '../../models/filter-predicate'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { single } from '../helpers/layout-builders'

const AT = new Date(2026, 0, 1)

function layout(id: number, tabs: LayoutTab[]): PersistedWorkspaceLayout {
  return { id, sortOrder: 0, name: `L${id}`, createdAt: AT, modifiedAt: AT, ...single({ id: `k${id}`, tabs }, { prefix: `l${id}-` }) }
}

const list = (id: number): PersistedListDefinition => ({
  id, name: `List ${id}`, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() },
})

const open = layout(1, [{ id: 'a', kind: 'lens', config: { listDefinitionId: 7 } }, { id: 'e', kind: 'lens', config: { listDefinitionId: 8 } }])
const other = layout(2, [{ id: 'f', kind: 'lens', config: { listDefinitionId: 7 } }, { id: 'g', kind: 'notes', config: {} }])

beforeEach(() => {
  useWorkspaceStore.setState({ layouts: [open, other], working: open, saved: open })
  useListDefinitionStore.setState({ listDefinitions: [list(7), list(8)] })
})

describe('countListWidgets', () => {
  it('counts the list tabs on the list, in every layout (the open one as edited), but the ones excepted', () => {
    const state = useWorkspaceStore.getState()
    expect(countListWidgets(state, 7)).toBe(2)
    expect(countListWidgets(state, 8)).toBe(1)
    expect(countListWidgets(state, 9)).toBe(0)
    expect(countListWidgets(state, 7, new Set(['a', 'e']))).toBe(1)
  })
})
