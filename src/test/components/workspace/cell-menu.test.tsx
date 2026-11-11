import { describe, it, expect, vi } from 'vitest'
import { createTab } from '../../../models/workspace-layout'
import type { MenuEntry } from '../../../components/shared/MenuPopover'
import { cellMenuEntries, mergedCellMenu, NO_MERGE_REASON, type CellMenuActions } from '../../../components/workspace/cell-menu'
import { widgetKindMenuEntries } from '../../../components/shared/widget-kind-menu-entries'

/**
 * The cell's ⋯ menu as composed (D26 AA1): the widget's entries under its
 * kind's heading (what its tab menu had), a separator, the cell's under
 * Cell in the table's words.
 */

/** Each entry as a word: an item's label, `—` a separator, `[text]` a label. */
function words(entries: readonly MenuEntry[]): string[] {
  return entries.map((e) => (e.kind === 'separator' ? '—' : e.kind === 'label' ? `[${e.text}]` : e.kind === 'item' ? e.label : e.kind))
}

function actions(over: Partial<CellMenuActions> = {}): CellMenuActions {
  const tab = createTab('notes', 'n')
  return {
    cell: { id: 'k', tabs: [tab] },
    tab,
    tabTitle: 'Notes',
    collapsed: false,
    onAddWidget: vi.fn(),
    onSplit: vi.fn(),
    onMerge: vi.fn(),
    onInsert: vi.fn(),
    onCollapse: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseCell: vi.fn(),
    mergeWith: () => undefined,
    ...over,
  }
}

describe('cellMenuEntries', () => {
  it('one widget: under Cell, Add widget…, Split, Merge, Insert, Collapse row, Close cell (no Close tab, no count)', () => {
    expect(words(cellMenuEntries(actions()))).toEqual([
      '[Cell]', 'Add widget…', 'Split cell', 'Merge with', 'Insert', 'Collapse row', '—', 'Close cell',
    ])
  })

  it('two widgets: Close tab for the menu’s widget, Close cell with the count; collapsed reads Expand row', () => {
    const a = createTab('notes', 'n')
    const b = createTab('calendar', 'c')
    const onCloseTab = vi.fn()
    const onCollapse = vi.fn()
    const entries = cellMenuEntries(actions({ cell: { id: 'k', tabs: [a, b] }, tab: b, tabTitle: 'Calendar', collapsed: true, onCloseTab, onCollapse }))
    expect(words(entries).slice(-4)).toEqual(['Expand row', '—', 'Close tab “Calendar”', 'Close cell (2 tabs)'])
    const item = (label: string) => entries.find((e) => e.kind === 'item' && e.label === label)
    const closeTab = item('Close tab “Calendar”')
    if (closeTab?.kind === 'item') closeTab.onSelect?.()
    expect(onCloseTab).toHaveBeenCalledWith('c')
    const expand = item('Expand row')
    if (expand?.kind === 'item') expand.onSelect?.()
    expect(onCollapse).toHaveBeenCalledWith(false)
  })

  it('Merge with ▸ is off, saying why, where no rectangle; on where one is', () => {
    const onMerge = vi.fn()
    const entries = cellMenuEntries(actions({ mergeWith: (_id, side) => (side === 'right' ? 'm' : undefined), onMerge }))
    const merge = entries.find((e) => e.kind === 'item' && e.label === 'Merge with')
    const children = merge?.kind === 'item' ? merge.children ?? [] : []
    const [right, below] = children
    expect(right).toMatchObject({ label: 'Right', disabled: false })
    expect(below).toMatchObject({ label: 'Below', disabled: true, title: NO_MERGE_REASON })
    if (right?.kind === 'item') right.onSelect?.()
    expect(onMerge).toHaveBeenCalledWith('m')
  })
})

describe('mergedCellMenu', () => {
  it('the widget’s entries first, one separator, then the cell’s', () => {
    const widget = widgetKindMenuEntries({ currentKind: 'notes', onChangeKind: () => {} })
    const merged = mergedCellMenu(widget, cellMenuEntries(actions()))
    expect(words(merged)).toEqual([
      '[Notes]', 'Change widget',
      '—', '[Cell]', 'Add widget…', 'Split cell', 'Merge with', 'Insert', 'Collapse row', '—', 'Close cell',
    ])
  })

  it('a list’s own items lead under its heading: Edit list…, its actions, then Change widget — no Change list', () => {
    const widget = widgetKindMenuEntries({
      currentKind: 'lens',
      onChangeKind: () => {},
      onEditList: () => {},
      widgetActions: [{ label: 'Copy tasks', onSelect: () => {} }],
    })
    const merged = words(mergedCellMenu(widget, cellMenuEntries(actions())))
    expect(merged.slice(0, 6)).toEqual(['[List]', 'Edit list…', 'Copy tasks', 'Change widget', '—', '[Cell]'])
    expect(merged).not.toContain('Change list')
    expect(merged.indexOf('Change widget')).toBeLessThan(merged.indexOf('Add widget…'))
  })

  it('never doubles a separator or leaves one at an end', () => {
    const merged = mergedCellMenu(
      [{ kind: 'separator' }, { kind: 'item', label: 'A' }, { kind: 'separator' }],
      [{ kind: 'separator' }, { kind: 'item', label: 'B' }, { kind: 'separator' }],
    )
    expect(words(merged)).toEqual(['A', '—', 'B'])
    expect(words(mergedCellMenu([], [{ kind: 'item', label: 'B' }]))).toEqual(['B'])
  })
})
