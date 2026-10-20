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

describe('listChoiceEntries (Change list)', () => {
  const defs = [
    def(2, 'B', { layoutId: 1 }), def(1, 'A', { layoutId: 1 }), def(6, 'No owner'),
    def(5, 'Other layout', { layoutId: 2 }), def(4, 'Eisenhower', { eisenhower: true }),
  ]

  it('offers the lists of the tab’s layout in their order, never another layout’s, the Eisenhower’s or one without an owner', () => {
    const entries = listChoiceEntries(defs, vi.fn(), 1)
    expect(labels(entries)).toEqual(['A', 'B'])
    expect(entries.map((e) => ('note' in e ? e.note : undefined))).toEqual([undefined, undefined])
  })

  it('a pick names its list', () => {
    const onPick = vi.fn()
    const [first] = listChoiceEntries(defs, onPick, 1)
    if (first?.kind === 'item') first.onSelect?.()
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('no list of the layout (or no stored layout): no choice', () => {
    expect(labels(listChoiceEntries(defs, vi.fn(), 3))).toEqual(['No lists yet.'])
    expect(labels(listChoiceEntries(defs, vi.fn(), undefined))).toEqual(['No lists yet.'])
  })
})
