import { describe, expect, it } from 'vitest'
import { createTab, type LayoutBody } from '../../models/workspace-layout'
import { isNumberView, numberTabOf, numberViewCell, numberViews, throughNumberViews } from '../../utils/number-views'
import { addTab, moveTab, removeTabKeepCell, setActiveTab, setTabLabel } from '../../utils/workspace-layout-ops'
import { cell, grid, numberItem, numbersTab, single } from '../helpers/layout-builders'

/**
 * The first step's adapter (`number-views`, temporary): the workspace draws
 * and edits each Number of a Numbers widget as a tab of its own, and an
 * edit made on that view is folded back into Numbers widgets.
 */

const ids = () => {
  let n = 0
  return () => `new-${++n}`
}
const notes = (id: string) => createTab('notes', id)
const STRIP = numbersTab('w', [numberItem('a'), numberItem('b', 'overdue', { icon: { kind: 'emoji', emoji: '⏰' } }), numberItem('c')], { name: 'Today' })
const strip = (): LayoutBody => grid([[cell('s', [STRIP], { activeTabId: 'w' }), cell('k', [notes('n')])]])

describe('numberViews', () => {
  it('each Number a tab of its own under its id, its icon on the tab; the active tab its first Number', () => {
    const body = strip()
    const view = numberViews(body)
    const s = view.cells[0]!
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(s.tabs.every(isNumberView)).toBe(true)
    expect(s.tabs[1]).toEqual({ id: 'b', kind: 'numbers', config: { items: [numberItem('b', 'overdue')] }, icon: { kind: 'emoji', emoji: '⏰' } })
    expect(s.activeTabId).toBe('a')
    expect(numberTabOf(s.tabs[1] as typeof STRIP)).toMatchObject({ id: 'b', kind: 'number', icon: { kind: 'emoji', emoji: '⏰' }, config: { name: 'Overdue' } })
    // The other cell as it is.
    expect(view.cells[1]).toBe(body.cells[1])

  })

  it('the same layout, the same view; a layout without a Numbers widget is its own view', () => {
    const body = strip()
    expect(numberViews(body)).toBe(numberViews(body))
    expect(numberViews(numberViews(body))).toBe(numberViews(body))
    const plain = single(cell('k', [notes('n')]))
    expect(numberViews(plain)).toBe(plain)
    expect(numberViewCell(plain.cells[0]!)).toBe(plain.cells[0])
  })
})

describe('throughNumberViews (an edit on the view, folded back)', () => {
  it('an edit that changes nothing gives the layout back', () => {
    const body = strip()
    expect(throughNumberViews(body, (v) => v, ids())).toBe(body)
  })

  it('a Number removed: the widget keeps its id, name and the others; the last one removed, the widget goes', () => {
    const out = throughNumberViews(strip(), (v) => removeTabKeepCell(v, 'b'), ids())
    expect(out.cells[0]!.tabs).toEqual([numbersTab('w', [numberItem('a'), numberItem('c')], { name: 'Today' })])
    const lone = single(cell('k', [numbersTab('w', [numberItem('a')])]))
    expect(throughNumberViews(lone, (v) => removeTabKeepCell(v, 'a'), ids()).cells[0]!.tabs).toEqual([])
  })

  it('a Number added to the strip joins its widget, at the end', () => {
    const added = createTab('numbers', 'x', { numberItemId: 'd' })
    const out = throughNumberViews(strip(), (v) => addTab(v, added, { kind: 'cell', cellId: 's' }, ids()), ids())
    expect(out.cells[0]!.tabs.map((t) => t.id)).toEqual(['w'])
    expect(out.cells[0]!.tabs[0]!.kind === 'numbers' && out.cells[0]!.tabs[0]!.config.items.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(out.cells[0]!.activeTabId).toBe('w')
  })

  it('a Number reordered in the strip keeps the widget; its icon stays its own', () => {
    const out = throughNumberViews(strip(), (v) => moveTab(v, 'b', { kind: 'cell', cellId: 's', index: 0 }, ids()), ids())
    const widget = out.cells[0]!.tabs[0]!
    expect(widget.id).toBe('w')
    expect(widget.kind === 'numbers' && widget.config.items.map((n) => [n.id, n.icon?.kind])).toEqual([['b', 'emoji'], ['a', undefined], ['c', undefined]])
  })

  it('a Number dragged into a cell of other kinds becomes a widget of its own there, a new id; the active tab follows it', () => {
    const gen = ids()
    const out = throughNumberViews(strip(), (v) => moveTab(v, 'a', { kind: 'cell', cellId: 'k' }, gen), gen)
    expect(out.cells[0]!.tabs[0]!.kind === 'numbers' && out.cells[0]!.tabs[0]!.config.items.map((n) => n.id)).toEqual(['b', 'c'])
    const k = out.cells[1]!
    expect(k.tabs).toEqual([notes('n'), numbersTab('new-1', [numberItem('a')])])
    expect(k.activeTabId).toBe('new-1')
  })

  it('a Number shown, renamed or given an icon: on its widget', () => {
    const mixed = single(cell('k', [notes('n'), numbersTab('w', [numberItem('a')])], { activeTabId: 'n' }))
    const shown = throughNumberViews(mixed, (v) => setActiveTab(v, 'a'), ids())
    expect(shown.cells[0]!.activeTabId).toBe('w')
    const iconed = throughNumberViews(mixed, (v) => setTabLabel(v, 'a', { icon: { kind: 'emoji', emoji: '🎯' } }), ids())
    expect(iconed.cells[0]!.tabs[1]).toEqual(numbersTab('w', [numberItem('a', 'open', { icon: { kind: 'emoji', emoji: '🎯' } })]))
  })

  it('a layout as stored, folded again, is as it was (an edit that ignores the view)', () => {
    const body = strip()
    const out = throughNumberViews(body, () => ({ ...body, cells: [...body.cells] }), ids())
    expect(out.cells).toEqual(body.cells)
  })
})
