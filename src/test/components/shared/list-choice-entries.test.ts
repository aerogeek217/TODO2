import { describe, it, expect, vi } from 'vitest'
import { listChoiceEntries } from '../../../components/shared/list-choice-entries'
import { emptyPredicate } from '../../../models/filter-predicate'
import type { ListOwner, PersistedListDefinition } from '../../../models/list-definition'

const def = (id: number, name: string, owner?: ListOwner): PersistedListDefinition => ({
  id, name, sortOrder: id, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() },
  ...(owner ? { owner } : {}),
})

const labels = (entries: ReturnType<typeof listChoiceEntries>) =>
  entries.map((e) => ('label' in e ? e.label : 'text' in e ? e.text : e.kind))

describe('listChoiceEntries (Change list, the Eisenhower’s Show)', () => {
  const defs = [def(2, 'B'), def(1, 'A'), def(3, 'Layout only', { layoutId: 1 }), def(4, 'Eisenhower', { eisenhower: true })]

  it('offers the saved lists in their order, never a hidden one', () => {
    expect(labels(listChoiceEntries(defs, vi.fn()))).toEqual(['A', 'B'])
    expect(labels(listChoiceEntries(defs, vi.fn(), { current: undefined }))).toEqual(['All tasks', 'separator', 'Saved lists', 'A', 'B'])
  })

  it('only hidden lists: no choice', () => {
    expect(labels(listChoiceEntries([defs[2]!, defs[3]!], vi.fn()))).toEqual(['No lists yet.'])
  })
})
