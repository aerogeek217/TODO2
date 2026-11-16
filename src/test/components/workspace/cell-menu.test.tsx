import { describe, it, expect, vi } from 'vitest'
import { createTab } from '../../../models/workspace-layout'
import type { MenuEntry } from '../../../components/shared/MenuPopover'
import {
  CELL_MENU_LABEL,
  cellMenuFor,
  editCardMenuEntries,
  mergedCellMenu,
  NO_MERGE_REASON,
  type CellMenuActions,
  type EditCardMenuActions,
} from '../../../components/workspace/cell-menu'
import { widgetKindMenuEntries } from '../../../components/shared/widget-kind-menu-entries'

/**
 * The cell's menus as composed (D26 AA1, UX cleanup 4A; layout edit mode
 * E3, E4 — edit mode changes the grid; what's inside a cell changes in
 * place): outside the mode the ⋯'s and a right-click's — the widget's
 * entries under its kind's heading, then Add widget as tab ›, Remove
 * widget, Collapse row, then Edit layout —; in the mode a card's (Cell
 * layout): Move to ▸, Swap with ▸, Split ▸, Merge with ▸, Stretch right /
 * down, Remove widget, Close cell.
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
    onCollapse: vi.fn(),
    onCloseTab: vi.fn(),
    onAddTab: vi.fn(),
    ...over,
  }
}

function cardActions(over: Partial<EditCardMenuActions> = {}): EditCardMenuActions {
  const tab = createTab('notes', 'n')
  return {
    cell: { id: 'k', tabs: [tab] },
    tab,
    slots: [{ cellId: 's1', label: 'B1' }, { cellId: 's2', label: 'A3' }],
    cards: [{ cellId: 'c2', label: 'Calendar', note: 'B2' }],
    mergeWith: () => undefined,
    canStretch: () => true,
    onMoveTo: vi.fn(),
    onSwap: vi.fn(),
    onSplit: vi.fn(),
    onMerge: vi.fn(),
    onStretch: vi.fn(),
    onRemoveWidget: vi.fn(),
    onCloseCell: vi.fn(),
    ...over,
  }
}

const item = (entries: readonly MenuEntry[], label: string) => entries.find((e) => e.kind === 'item' && e.label === label)
const childrenOf = (entries: readonly MenuEntry[], label: string): MenuEntry[] => {
  const e = item(entries, label)
  return e?.kind === 'item' ? [...(e.children ?? [])] : []
}
const select = (entry: MenuEntry | undefined) => { if (entry?.kind === 'item') entry.onSelect?.() }

describe('editCardMenuEntries (a card’s menu in the layout edit mode)', () => {
  it('Move to, Swap with, Split, Merge with, Stretch right / down, then Remove widget and Close cell', () => {
    expect(words(editCardMenuEntries(cardActions()))).toEqual([
      'Move to', 'Swap with', 'Split', 'Merge with', 'Stretch right', 'Stretch down', '—', 'Remove widget', 'Close cell',
    ])
  })

  it('Move to lists every slot by its ruler name; Swap with every other card by name, its place beside it', () => {
    const onMoveTo = vi.fn()
    const onSwap = vi.fn()
    const entries = editCardMenuEntries(cardActions({ onMoveTo, onSwap }))
    expect(words(childrenOf(entries, 'Move to'))).toEqual(['B1', 'A3'])
    const swap = childrenOf(entries, 'Swap with')
    expect(words(swap)).toEqual(['Calendar'])
    expect(swap[0]?.kind === 'item' && swap[0].note).toBe('B2')
    select(item(childrenOf(entries, 'Move to'), 'A3'))
    select(item(swap, 'Calendar'))
    expect(onMoveTo).toHaveBeenCalledWith('s2')
    expect(onSwap).toHaveBeenCalledWith('c2')
  })

  it('no slot or no other card: the entry is off, saying why', () => {
    const entries = editCardMenuEntries(cardActions({ slots: [], cards: [] }))
    const move = item(entries, 'Move to')
    const swap = item(entries, 'Swap with')
    expect(move?.kind === 'item' && move.disabled).toBe(true)
    expect(move?.kind === 'item' && move.title).toMatch(/empty slot/)
    expect(swap?.kind === 'item' && swap.disabled).toBe(true)
  })

  it('Split and Merge with offer every side; Merge is off where the two make no rectangle', () => {
    const onSplit = vi.fn()
    const onMerge = vi.fn()
    const entries = editCardMenuEntries(cardActions({ onSplit, onMerge, mergeWith: (side) => (side === 'right' ? 'm' : undefined) }))
    expect(words(childrenOf(entries, 'Split'))).toEqual(['Above', 'Left', 'Right', 'Below'])
    const merge = childrenOf(entries, 'Merge with')
    expect(words(merge)).toEqual(['Above', 'Left', 'Right', 'Below'])
    const above = item(merge, 'Above')
    expect(above?.kind === 'item' && above.disabled).toBe(true)
    expect(above?.kind === 'item' && above.title).toBe(NO_MERGE_REASON)
    select(item(merge, 'Right'))
    select(item(childrenOf(entries, 'Split'), 'Below'))
    expect(onMerge).toHaveBeenCalledWith('m')
    expect(onSplit).toHaveBeenCalledWith('bottom')
  })

  it('Stretch right / down: off where no empty slot runs along that side; on, it stretches', () => {
    const onStretch = vi.fn()
    const entries = editCardMenuEntries(cardActions({ onStretch, canStretch: (d) => d === 'down' }))
    const right = item(entries, 'Stretch right')
    expect(right?.kind === 'item' && right.disabled).toBe(true)
    select(item(entries, 'Stretch down'))
    expect(onStretch).toHaveBeenCalledWith('down')
  })

  it('Remove tab (two widgets: a tab strip) removes the menu’s widget; Close cell with the count', () => {
    const onRemoveWidget = vi.fn()
    const onCloseCell = vi.fn()
    const a = createTab('notes', 'a')
    const b = createTab('calendar', 'b')
    const entries = editCardMenuEntries(cardActions({ cell: { id: 'k', tabs: [a, b] }, tab: b, onRemoveWidget, onCloseCell }))
    expect(item(entries, 'Remove widget')).toBeUndefined()
    select(item(entries, 'Remove tab'))
    select(item(entries, 'Close cell (2 tabs)'))
    expect(onRemoveWidget).toHaveBeenCalledWith('b')
    expect(onCloseCell).toHaveBeenCalled()
  })
})

describe('cellMenuFor (outside the mode: what is inside a cell changes in place)', () => {
  const notes = () => widgetKindMenuEntries({ currentKind: 'notes', onChangeKind: () => {} })

  it('the ⋯: the widget’s entries, Add widget as tab ›, Remove widget, Collapse row, then Edit layout', () => {
    expect(words(cellMenuFor(notes(), actions({ onEditLayout: vi.fn() })))).toEqual([
      '[Notes]', 'Change widget', '—', 'Add widget as tab', 'Remove widget', 'Collapse row', '—', 'Edit layout',
    ])
  })

  it('Add widget as tab › lists every kind under Tasks and Insights; a Breakdown opens its presets', () => {
    const onAddTab = vi.fn()
    const add = childrenOf(cellMenuFor(notes(), actions({ onAddTab })), 'Add widget as tab')
    expect(words(add)).toEqual([
      '[Tasks]', 'List', 'Calendar', 'Review', 'Notes',
      '—', '[Insights]', 'Number', 'Breakdown', 'Pivot', 'Created vs completed', 'Project pulse', 'Neglect map',
    ])
    select(item(add, 'Calendar'))
    select(item(childrenOf(add, 'Breakdown'), 'People'))
    expect(onAddTab.mock.calls).toEqual([['calendar'], ['breakdown', 'people']])
  })

  it('Remove widget removes the menu’s widget', () => {
    const onCloseTab = vi.fn()
    select(item(cellMenuFor(notes(), actions({ onCloseTab })), 'Remove widget'))
    expect(onCloseTab).toHaveBeenCalledWith('n')
  })

  it('a cell showing a tab strip reads Add tab › and Remove tab; a Numbers strip keeps the widget words', () => {
    const strip = actions({ cell: { id: 'k', tabs: [createTab('notes', 'n'), createTab('calendar', 'c')] } })
    expect(words(cellMenuFor(notes(), strip))).toEqual(['[Notes]', 'Change widget', '—', 'Add tab', 'Remove tab', 'Collapse row'])
    const numbers = actions({ cell: { id: 'k', tabs: [createTab('number', 'n'), createTab('number', 'm')] } })
    expect(words(cellMenuFor(notes(), numbers))).toEqual(['[Notes]', 'Change widget', '—', 'Add widget as tab', 'Remove widget', 'Collapse row'])
  })

  it('collapsed reads Expand row, which expands it', () => {
    const onCollapse = vi.fn()
    select(item(cellMenuFor(notes(), actions({ collapsed: true, onCollapse })), 'Expand row'))
    expect(onCollapse).toHaveBeenCalledWith(false)
  })

  it('names the ⋯’s menu and the whole one Cell options', () => {
    expect(CELL_MENU_LABEL).toEqual({ widget: 'Cell options', all: 'Cell options' })
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
    const merged = words(mergedCellMenu(widget, [{ kind: 'item', label: 'Remove widget' }]))
    expect(merged).toEqual(['[List]', 'Edit list…', 'Copy tasks', 'Change widget', '—', 'Remove widget'])
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
