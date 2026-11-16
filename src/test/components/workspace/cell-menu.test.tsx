import { describe, it, expect, vi } from 'vitest'
import { createTab } from '../../../models/workspace-layout'
import type { MenuEntry } from '../../../components/shared/MenuPopover'
import { CELL_MENU_LABEL, cellMenuEntries, cellMenuFor, mergedCellMenu, NO_MERGE_REASON, type CellMenuActions } from '../../../components/workspace/cell-menu'
import { widgetKindMenuEntries } from '../../../components/shared/widget-kind-menu-entries'

/**
 * The cell's menus as composed (D26 AA1, UX cleanup 4A; layout edit mode
 * E4 — edit mode changes the grid; what's inside a cell changes in place):
 * outside the mode the ⋯'s and a right-click's — the widget's entries under
 * its kind's heading, then Add widget as tab ›, Remove widget, Collapse
 * row, then Edit layout —; the grip's, only in the mode, and every menu in
 * the mode — the layout entries under Layout: Add widget…, Split cell ▸,
 * Insert row ▸, Insert column ▸, Merge with ▸, Collapse row, Close cell.
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
    onInsertBeside: vi.fn(),
    onCollapse: vi.fn(),
    onCloseTab: vi.fn(),
    onAddTab: vi.fn(),
    onCloseCell: vi.fn(),
    mergeWith: () => undefined,
    ...over,
  }
}

const item = (entries: readonly MenuEntry[], label: string) => entries.find((e) => e.kind === 'item' && e.label === label)
const childrenOf = (entries: readonly MenuEntry[], label: string): MenuEntry[] => {
  const e = item(entries, label)
  return e?.kind === 'item' ? [...(e.children ?? [])] : []
}

describe('cellMenuEntries', () => {
  it('under Layout: Add widget…, Split cell, Insert row, Insert column, Merge with, Collapse row, Close cell', () => {
    expect(words(cellMenuEntries(actions()))).toEqual([
      '[Layout]', 'Add widget…', 'Split cell', 'Insert row', 'Insert column', 'Merge with', 'Collapse row', '—', 'Close cell',
    ])
  })

  it('Split cell and Merge with offer every side; the insert menus beside this cell, then at the edges', () => {
    const entries = cellMenuEntries(actions())
    expect(words(childrenOf(entries, 'Split cell'))).toEqual(['Above', 'Left', 'Right', 'Below'])
    expect(words(childrenOf(entries, 'Merge with'))).toEqual(['Above', 'Left', 'Right', 'Below'])
    expect(words(childrenOf(entries, 'Insert row'))).toEqual(['Above this row', 'Below this row', '—', 'At the top', 'At the bottom'])
    expect(words(childrenOf(entries, 'Insert column'))).toEqual(['Left of this column', 'Right of this column', '—', 'At the far left', 'At the far right'])
  })

  it('each insert and split runs its action with its side', () => {
    const onInsertBeside = vi.fn()
    const onInsert = vi.fn()
    const onSplit = vi.fn()
    const entries = cellMenuEntries(actions({ onInsertBeside, onInsert, onSplit }))
    const run = (menu: string, label: string) => {
      const e = item(childrenOf(entries, menu), label)
      if (e?.kind === 'item') e.onSelect?.()
    }
    run('Insert row', 'Above this row')
    run('Insert column', 'Right of this column')
    run('Insert row', 'At the bottom')
    run('Split cell', 'Left')
    expect(onInsertBeside.mock.calls).toEqual([['top'], ['right']])
    expect(onInsert).toHaveBeenCalledWith('bottom')
    expect(onSplit).toHaveBeenCalledWith('left')
  })

  it('two widgets: Close cell with the count; collapsed reads Expand row', () => {
    const a = createTab('notes', 'n')
    const b = createTab('calendar', 'c')
    const onCollapse = vi.fn()
    const entries = cellMenuEntries(actions({ cell: { id: 'k', tabs: [a, b] }, tab: b, tabTitle: 'Calendar', collapsed: true, onCollapse }))
    expect(words(entries).slice(-3)).toEqual(['Expand row', '—', 'Close cell (2 tabs)'])
    const expand = item(entries, 'Expand row')
    if (expand?.kind === 'item') expand.onSelect?.()
    expect(onCollapse).toHaveBeenCalledWith(false)
  })

  it('Merge with ▸ a side is off, saying why, where no rectangle; on where one is', () => {
    const onMerge = vi.fn()
    const entries = cellMenuEntries(actions({ mergeWith: (_id, side) => (side === 'right' ? 'm' : undefined), onMerge }))
    const merge = childrenOf(entries, 'Merge with')
    expect(item(merge, 'Right')).toMatchObject({ disabled: false })
    expect(item(merge, 'Below')).toMatchObject({ disabled: true, title: NO_MERGE_REASON })
    const right = item(merge, 'Right')
    if (right?.kind === 'item') right.onSelect?.()
    expect(onMerge).toHaveBeenCalledWith('m')
  })
})

describe('cellMenuFor (E4: edit mode changes the grid; what is inside a cell changes in place)', () => {
  const notes = () => widgetKindMenuEntries({ currentKind: 'notes', onChangeKind: () => {} })

  it('the ⋯ outside the mode: the widget’s entries, Add widget as tab ›, Remove widget, Collapse row, then Edit layout', () => {
    expect(words(cellMenuFor('widget', notes(), actions({ onEditLayout: vi.fn() })))).toEqual([
      '[Notes]', 'Change widget', '—', 'Add widget as tab', 'Remove widget', 'Collapse row', '—', 'Edit layout',
    ])
  })

  it('a right-click outside the mode: the same menu — no Layout section', () => {
    const a = actions({ onEditLayout: vi.fn() })
    expect(words(cellMenuFor('all', notes(), a))).toEqual(words(cellMenuFor('widget', notes(), a)))
  })

  it('Add widget as tab › lists every kind under Tasks and Insights; a Breakdown opens its presets', () => {
    const onAddTab = vi.fn()
    const add = childrenOf(cellMenuFor('widget', notes(), actions({ onAddTab })), 'Add widget as tab')
    expect(words(add)).toEqual([
      '[Tasks]', 'List', 'Calendar', 'Review', 'Notes',
      '—', '[Insights]', 'Number', 'Breakdown', 'Pivot', 'Created vs completed', 'Project pulse', 'Neglect map',
    ])
    const calendar = item(add, 'Calendar')
    if (calendar?.kind === 'item') calendar.onSelect?.()
    const people = item(childrenOf(add, 'Breakdown'), 'People')
    if (people?.kind === 'item') people.onSelect?.()
    expect(onAddTab.mock.calls).toEqual([['calendar'], ['breakdown', 'people']])
  })

  it('Remove widget removes the menu’s widget', () => {
    const onCloseTab = vi.fn()
    const remove = item(cellMenuFor('widget', notes(), actions({ onCloseTab })), 'Remove widget')
    if (remove?.kind === 'item') remove.onSelect?.()
    expect(onCloseTab).toHaveBeenCalledWith('n')
  })

  it('collapsed reads Expand row, which expands it', () => {
    const onCollapse = vi.fn()
    const expand = item(cellMenuFor('widget', notes(), actions({ collapsed: true, onCollapse })), 'Expand row')
    if (expand?.kind === 'item') expand.onSelect?.()
    expect(onCollapse).toHaveBeenCalledWith(false)
  })

  it('the grip (layout, only drawn in the mode) and every menu in the mode: the layout entries under Layout', () => {
    const layout = ['[Layout]', 'Add widget…', 'Split cell', 'Insert row', 'Insert column', 'Merge with', 'Collapse row', '—', 'Close cell']
    expect(words(cellMenuFor('layout', notes(), actions()))).toEqual(layout)
    expect(words(cellMenuFor('widget', notes(), actions({ editing: true })))).toEqual(layout)
    expect(words(cellMenuFor('all', notes(), actions({ editing: true })))).toEqual(layout)
  })

  it('Add widget… in the grip’s menu runs the cell’s add', () => {
    const onAddWidget = vi.fn()
    const add = item(cellMenuFor('layout', notes(), actions({ onAddWidget })), 'Add widget…')
    if (add?.kind === 'item') add.onSelect?.()
    expect(onAddWidget).toHaveBeenCalled()
  })

  it('names the grip’s menu Cell layout, the ⋯’s and the whole one Cell options', () => {
    expect(CELL_MENU_LABEL).toEqual({ widget: 'Cell options', layout: 'Cell layout', all: 'Cell options' })
  })
})

describe('mergedCellMenu', () => {
  it('a list’s own items lead under its heading: Edit list…, its actions, then Change widget — no Change list', () => {
    const widget = widgetKindMenuEntries({
      currentKind: 'lens',
      onChangeKind: () => {},
      onEditList: () => {},
      widgetActions: [{ label: 'Copy tasks', onSelect: () => {} }],
    })
    const merged = words(mergedCellMenu(widget, cellMenuEntries(actions())))
    expect(merged.slice(0, 6)).toEqual(['[List]', 'Edit list…', 'Copy tasks', 'Change widget', '—', '[Layout]'])
    expect(merged).not.toContain('Change list')
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
