import { describe, expect, it } from 'vitest'
import type { LayoutTab, NumberTab } from '../../models/workspace-layout'
import { layoutListRefs, listIdChanges, repointLayoutLists } from '../../utils/workspace-layout-lists'
import { cell, grid, numberTab, single } from '../helpers/layout-builders'

describe('a Number that follows a list names it as the layout’s own (D26 P6)', () => {
  const lens = (id: string, listDefinitionId: number): LayoutTab => ({ id, kind: 'lens', config: { listDefinitionId } })
  const follows = (id: string, listDefinitionId: number): LayoutTab => numberTab(id, 'open', { show: 'list', list: { listDefinitionId } })

  it('counts among the layout’s lists only while it follows one', () => {
    const body = grid([[cell('a', [lens('l', 1)]), cell('b', [follows('n', 2), numberTab('m', 'open', { show: 'count' })])]])
    expect([...layoutListRefs(body)].sort()).toEqual([1, 2])
    expect(layoutListRefs(single(cell('a', [numberTab('n', 'open', { show: 'list' })])))).toEqual(new Set())
  })

  it('is repointed with the layout’s lists (Save as), and its change is one', () => {
    const body = grid([[cell('a', [lens('l', 1)]), cell('b', [follows('n', 2)])]])
    const moved = repointLayoutLists(body, new Map([[2, 20], [1, 10]]))
    expect(layoutListRefs(moved)).toEqual(new Set([10, 20]))
    expect((moved.cells[1]!.tabs[0] as NumberTab).config).toMatchObject({ show: 'list', list: { listDefinitionId: 20 } })
    expect(listIdChanges(body, moved)).toEqual(new Map([[1, 10], [2, 20]]))
    // Nothing to repoint: the same object.
    expect(repointLayoutLists(body, new Map([[7, 70]]))).toBe(body)
  })
})
