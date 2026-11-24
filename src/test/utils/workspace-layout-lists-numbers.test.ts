import { describe, expect, it } from 'vitest'
import type { LayoutTab, NumbersTab } from '../../models/workspace-layout'
import { layoutListRefs, repointLayoutLists } from '../../utils/workspace-layout-lists'
import { cell, grid, numberItem, numbersTab, numberTab, single } from '../helpers/layout-builders'

describe('a Number that follows a list names it as the layout’s own (D26 P6)', () => {
  const lens = (id: string, listDefinitionId: number): LayoutTab => ({ id, kind: 'lens', config: { listDefinitionId } })
  const follows = (id: string, listDefinitionId: number): LayoutTab => numberTab(id, 'open', { show: 'list', list: { listDefinitionId } })

  it('counts among the layout’s lists only while it follows one', () => {
    const body = grid([[cell('a', [lens('l', 1)]), cell('b', [follows('n', 2), numberTab('m', 'open', { show: 'count' })])]])
    expect([...layoutListRefs(body)].sort()).toEqual([1, 2])
    expect(layoutListRefs(single(cell('a', [numberTab('n', 'open', { show: 'list' })])))).toEqual(new Set())
  })

  it('every Number of a Numbers widget is walked (v90)', () => {
    const widget = numbersTab('w', [
      numberItem('a', 'open', { show: 'list', list: { listDefinitionId: 3 } }),
      numberItem('b', 'open'),
      numberItem('c', 'open', { show: 'list', list: { listDefinitionId: 4 } }),
    ])
    const body = single(cell('k', [widget]))
    expect([...layoutListRefs(body)].sort()).toEqual([3, 4])
    const moved = repointLayoutLists(body, new Map([[4, 40]]))
    expect((moved.cells[0]!.tabs[0] as NumbersTab).config.items.map((n) => n.list?.listDefinitionId)).toEqual([3, undefined, 40])
    // The Numbers it doesn't repoint stay the same objects.
    expect((moved.cells[0]!.tabs[0] as NumbersTab).config.items[0]).toBe(widget.config.items[0])
  })

  it('is repointed with the layout’s lists (Save as)', () => {
    const body = grid([[cell('a', [lens('l', 1)]), cell('b', [follows('n', 2)])]])
    const moved = repointLayoutLists(body, new Map([[2, 20], [1, 10]]))
    expect(layoutListRefs(moved)).toEqual(new Set([10, 20]))
    expect((moved.cells[1]!.tabs[0] as NumbersTab).config.items[0]).toMatchObject({ show: 'list', list: { listDefinitionId: 20 } })
    // Nothing to repoint: the same object.
    expect(repointLayoutLists(body, new Map([[7, 70]]))).toBe(body)
  })
})
