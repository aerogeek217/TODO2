import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { reconcileListDefDraft, useListDefDraft } from '../../hooks/use-list-def-draft'
import type { PersistedListDefinition } from '../../models/list-definition'

function makeDef(overrides: Partial<PersistedListDefinition> = {}): PersistedListDefinition {
  return {
    id: 1,
    name: 'Inbox',
    sortOrder: 0,
    membership: { kind: 'custom', predicate: {} },
    sort: 'manual',
    grouping: 'none',
    pinnedToDashboard: false,
    ...overrides,
  } as PersistedListDefinition
}

describe('reconcileListDefDraft', () => {
  it('returns null when upstream is gone', () => {
    expect(reconcileListDefDraft(makeDef(), null)).toBeNull()
  })

  it('adopts upstream when there is no draft or the def changed', () => {
    const up = makeDef({ id: 2 })
    expect(reconcileListDefDraft(null, up)).toBe(up)
    expect(reconcileListDefDraft(makeDef({ id: 1 }), up)).toBe(up)
  })

  it('adopts upstream when the draft is clean', () => {
    const up = makeDef()
    expect(reconcileListDefDraft(makeDef(), up)).toBe(up)
  })

  it('keeps dirty edits but forwards pin / sortOrder', () => {
    const draft = makeDef({ name: 'Edited' })
    const up = makeDef({ pinnedToDashboard: true, sortOrder: 5 })
    expect(reconcileListDefDraft(draft, up)).toEqual({
      ...draft,
      pinnedToDashboard: true,
      sortOrder: 5,
    })
  })
})

describe('useListDefDraft', () => {
  it('seeds the draft from upstream on the first render (no null frame)', () => {
    const up = makeDef()
    const { result } = renderHook(() => useListDefDraft(up))
    expect(result.current[0]).toBe(up)
  })

  it('re-syncs on upstream change, preserving dirty edits', () => {
    const v1 = makeDef()
    const { result, rerender } = renderHook(({ up }) => useListDefDraft(up), {
      initialProps: { up: v1 as PersistedListDefinition | null },
    })
    act(() => result.current[1]({ ...v1, name: 'Edited' }))
    const v2 = makeDef({ sortOrder: 7 })
    rerender({ up: v2 })
    expect(result.current[0]?.name).toBe('Edited')
    expect(result.current[0]?.sortOrder).toBe(7)
    rerender({ up: null })
    expect(result.current[0]).toBeNull()
  })
})
