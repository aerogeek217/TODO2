import { describe, it, expect } from 'vitest'
import {
  isRetiredEisenhowerOwner,
  isListedList,
  listedLists,
  ownerLayoutId,
  type ListOwner,
} from '../../models/list-definition'

const def = (id: number, owner?: ListOwner) => ({ id, ...(owner ? { owner } : {}) })

describe('list owners', () => {
  it('a list is offered only in the layout that owns it: never another layout’s, the retired Eisenhower’s or one without an owner', () => {
    expect(isListedList(def(2, { layoutId: 3 }), 3)).toBe(true)
    expect(isListedList(def(2, { layoutId: 3 }), 4)).toBe(false)
    expect(isListedList(def(2, { layoutId: 3 }), undefined)).toBe(false)
    expect(isListedList(def(1), 3)).toBe(false)
    expect(isListedList(def(1), undefined)).toBe(false)
    expect(isListedList(def(3, { eisenhower: true }), 3)).toBe(false)
  })

  it('listedLists keeps the offered lists in their order', () => {
    const defs = [def(1), def(6, { layoutId: 9 }), def(2, { layoutId: 9 }), def(3, { eisenhower: true }), def(5, { layoutId: 8 })]
    expect(listedLists(defs, 9).map((d) => d.id)).toEqual([6, 2])
    expect(listedLists(defs, undefined)).toEqual([])
  })

  it('reads an owner', () => {
    expect(ownerLayoutId(def(1, { layoutId: 7 }))).toBe(7)
    expect(ownerLayoutId(def(1, { eisenhower: true }))).toBeUndefined()
    expect(ownerLayoutId(def(1))).toBeUndefined()
    expect(isRetiredEisenhowerOwner({ eisenhower: true })).toBe(true)
    expect(isRetiredEisenhowerOwner({ layoutId: 1 })).toBe(false)
    expect(isRetiredEisenhowerOwner(undefined)).toBe(false)
  })
})

describe('an owner that isn’t an object (a database another build wrote)', () => {
  it('reads as no layout and no Eisenhower — never throws — and the list is not offered', () => {
    for (const owner of ['x', 3, true]) {
      const def = { owner: owner as unknown as ListOwner }
      expect(ownerLayoutId(def)).toBeUndefined()
      expect(isRetiredEisenhowerOwner(def.owner)).toBe(false)
      expect(isListedList(def, undefined)).toBe(false)
      expect(isListedList(def, 1)).toBe(false)
    }
  })
})
