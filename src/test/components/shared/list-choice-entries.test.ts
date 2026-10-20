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
    def(2, 'B'), def(1, 'A'), def(3, 'Layout only', { layoutId: 1 }),
    def(5, 'Other layout', { layoutId: 2 }), def(4, 'Eisenhower', { eisenhower: true }),
  ]

  it('offers the saved lists in their order, never a hidden one', () => {
    expect(labels(listChoiceEntries(defs, vi.fn()))).toEqual(['A', 'B'])
  })

  it('in a saved layout: its own lists too, marked, never another layout’s or the Eisenhower’s', () => {
    const entries = listChoiceEntries(defs, vi.fn(), 1)
    expect(labels(entries)).toEqual(['A', 'B', 'Layout only'])
    expect(entries.map((e) => ('note' in e ? e.note : undefined))).toEqual([undefined, undefined, 'This layout'])
  })

  it('a pick names its list', () => {
    const onPick = vi.fn()
    const [first] = listChoiceEntries(defs, onPick, 1)
    if (first?.kind === 'item') first.onSelect?.()
    expect(onPick).toHaveBeenCalledWith(1)
  })

  it('only hidden lists: no choice', () => {
    expect(labels(listChoiceEntries([defs[2]!, defs[4]!], vi.fn()))).toEqual(['No lists yet.'])
  })
})
