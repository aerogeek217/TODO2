import { describe, it, expect } from 'vitest'
import { createTab, type LayoutTab } from '../../models/workspace-layout'
import {
  carriedTabs,
  incomingListIds,
  incomingPlaced,
  transferListPlan,
  type IncomingTransfer,
} from '../../utils/layout-transfer'
import { cell, emptyBody, grid, single, freshNumberTab, numberItem, numbersTab } from '../helpers/layout-builders'

const list = (id: string, listDefinitionId: number): LayoutTab => createTab('lens', id, { listDefinitionId })
/** A Numbers widget of one Number (`id`) following list `listDefinitionId`. */
const follower = (id: string, listDefinitionId: number): LayoutTab => {
  const tab = freshNumberTab(id)
  return { ...tab, config: { items: [{ ...tab.config.items[0]!, show: 'list', list: { listDefinitionId } }] } }
}
const gen = () => {
  let n = 0
  return () => `new-${++n}`
}

function incoming(tabs: LayoutTab[], over: Partial<IncomingTransfer> = {}): IncomingTransfer {
  return { copy: false, sourceLayoutId: 1, sourceName: 'A', sourceTabIds: tabs.map((t) => t.id), tabs, name: 'X', ...over }
}

describe('carriedTabs', () => {
  const source = grid([[cell('c1', [createTab('notes', 'a'), createTab('notes', 'b')], { activeTabId: 'b' }), cell('c2', [createTab('notes', 'z')])]])

  it('a Numbers widget lands with its Numbers’ ids new to the target where they are taken there (C2), one id renamed the same everywhere', () => {
    const widget = numbersTab('w', [numberItem('n1'), numberItem('n2')])
    const from = single(cell('c', [widget]))
    const target = single(cell('t', [createTab('notes', 'n1')]))
    const r = carriedTabs(from, { kind: 'tab', tabId: 'w' }, target, gen())
    expect(r?.tabs).toEqual([numbersTab('w', [numberItem('new-1'), numberItem('n2')])])
    // A Number viewed as a tab of its own (its id the tab's and the Number's) keeps them one id.
    const view = numbersTab('n1', [numberItem('n1')])
    const r2 = carriedTabs(single(cell('c', [view])), { kind: 'tab', tabId: 'n1' }, target, gen())
    expect(r2?.tabs).toEqual([numbersTab('new-1', [numberItem('new-1')])])
  })

  it('carries one tab', () => {
    const r = carriedTabs(source, { kind: 'tab', tabId: 'z' }, emptyBody(), gen())
    expect(r?.sourceTabIds).toEqual(['z'])
    expect(r?.tabs.map((t) => t.id)).toEqual(['z'])
    expect(r?.activeTabId).toBeUndefined()
  })

  it('carries a cell with its tabs in order and its active tab', () => {
    const r = carriedTabs(source, { kind: 'cell', cellId: 'c1' }, emptyBody(), gen())
    expect(r?.tabs.map((t) => t.id)).toEqual(['a', 'b'])
    expect(r?.activeTabId).toBe('b')
  })

  it('gives a tab whose id the target uses a new id, and maps the active tab', () => {
    const target = single(cell('t', [createTab('notes', 'b')]))
    const r = carriedTabs(source, { kind: 'cell', cellId: 'c1' }, target, gen())
    expect(r?.sourceTabIds).toEqual(['a', 'b'])
    expect(r?.tabs.map((t) => t.id)).toEqual(['a', 'new-1'])
    expect(r?.activeTabId).toBe('new-1')
  })

  it('a tab id equal to a cell id of the target counts as taken', () => {
    const r = carriedTabs(source, { kind: 'tab', tabId: 'z' }, single(cell('z')), gen())
    expect(r?.tabs.map((t) => t.id)).toEqual(['new-1'])
  })

  it('is null for a missing tab, a missing cell or a cell with no tabs', () => {
    expect(carriedTabs(source, { kind: 'tab', tabId: 'nope' }, emptyBody(), gen())).toBeNull()
    expect(carriedTabs(source, { kind: 'cell', cellId: 'nope' }, emptyBody(), gen())).toBeNull()
    expect(carriedTabs(single(cell('e')), { kind: 'cell', cellId: 'e' }, emptyBody(), gen())).toBeNull()
  })
})

describe('incomingPlaced', () => {
  const inc = incoming([createTab('notes', 'a'), createTab('notes', 'b')])

  it('is true only when every carried tab is in the draft', () => {
    expect(incomingPlaced(single(cell('k', [createTab('notes', 'a'), createTab('notes', 'b')])), inc)).toBe(true)
    expect(incomingPlaced(single(cell('k', [createTab('notes', 'a')])), inc)).toBe(false)
  })

  it('is false without a draft or without incoming', () => {
    expect(incomingPlaced(null, inc)).toBe(false)
    expect(incomingPlaced(emptyBody(), null)).toBe(false)
    expect(incomingPlaced(emptyBody(), undefined)).toBe(false)
  })
})

describe('incomingListIds', () => {
  it('names the lists of list tabs and of Numbers following one', () => {
    const ids = [...incomingListIds(incoming([list('l', 5), createTab('notes', 'x'), follower('n', 7)]))]
    expect(ids.sort()).toEqual([5, 7])
  })

  it('is empty without incoming', () => {
    expect(incomingListIds(null).size).toBe(0)
  })
})

describe('transferListPlan', () => {
  const inc = (copy: boolean) => incoming([list('l', 5)], { copy })
  const draft = single(cell('k', [list('l', 5)]))

  it('a copy copies every carried list the draft shows', () => {
    expect(transferListPlan(inc(true), draft, null)).toEqual({ reown: [], copy: [5] })
    expect(transferListPlan(inc(true), draft, emptyBody())).toEqual({ reown: [], copy: [5] })
  })

  it('a move hands the list over when the source no longer names it', () => {
    expect(transferListPlan(inc(false), draft, single(cell('s')))).toEqual({ reown: [5], copy: [] })
  })

  it('a move copies when the source keeps another tab on the list', () => {
    expect(transferListPlan(inc(false), draft, single(cell('s', [list('other', 5)])))).toEqual({ reown: [], copy: [5] })
  })

  it('a move copies when a Number in the source follows the list', () => {
    expect(transferListPlan(inc(false), draft, single(cell('s', [follower('n', 5)])))).toEqual({ reown: [], copy: [5] })
  })

  it('skips lists the draft no longer shows', () => {
    expect(transferListPlan(inc(false), single(cell('k')), single(cell('s')))).toEqual({ reown: [], copy: [] })
    expect(transferListPlan(inc(true), single(cell('k')), null)).toEqual({ reown: [], copy: [] })
  })
})
