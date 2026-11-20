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
 * layout): Move to ▸, Swap with ▸, Insert ▸, Merge with ▸, Stretch right /
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
    onJoin: vi.fn(),
    onSplit: vi.fn(),
    onInsertTrack: vi.fn(),
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
  it('Move to, Swap with, Insert, Merge with, Stretch right / down, then Remove widget and Close cell', () => {
    expect(words(editCardMenuEntries(cardActions()))).toEqual([
      'Move to', 'Swap with', 'Join as tabs', 'Insert', 'Merge with', 'Stretch right', 'Stretch down', '—', 'Remove widget', 'Close cell',
    ])
  })

  it('Join as tabs lists the same cards: a pick joins this card’s tabs to it; with no other card it is off', () => {
    const onJoin = vi.fn()
    const join = item(editCardMenuEntries(cardActions({ onJoin })), 'Join as tabs')
    const children = join?.kind === 'item' ? join.children ?? [] : []
    expect(children.map((c) => (c.kind === 'item' ? [c.label, c.note] : null))).toEqual([['Calendar', 'B2']])
    select(children[0])
    expect(onJoin).toHaveBeenCalledWith('c2')
    const none = item(editCardMenuEntries(cardActions({ cards: [] })), 'Join as tabs')
    expect(none?.kind === 'item' && none.disabled).toBe(true)
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

  it('Insert offers a full row / column on each side, then the cell split; Merge is off where the two make no rectangle', () => {
    const onSplit = vi.fn()
    const onInsertTrack = vi.fn()
    const onMerge = vi.fn()
    const entries = editCardMenuEntries(cardActions({ onSplit, onInsertTrack, onMerge, mergeWith: (side) => (side === 'right' ? 'm' : undefined) }))
    const insert = childrenOf(entries, 'Insert')
    expect(words(insert)).toEqual(['Row above', 'Row below', 'Column left', 'Column right', '—', '[Split this cell]', 'New cell above', 'New cell left', 'New cell right', 'New cell below'])
    select(item(insert, 'Row above'))
    expect(onInsertTrack).toHaveBeenCalledWith('top')
    const merge = childrenOf(entries, 'Merge with')
    expect(words(merge)).toEqual(['Above', 'Left', 'Right', 'Below'])
    const above = item(merge, 'Above')
    expect(above?.kind === 'item' && above.disabled).toBe(true)
    expect(above?.kind === 'item' && above.title).toBe(NO_MERGE_REASON)
    select(item(merge, 'Right'))
    select(item(insert, 'New cell below'))
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
      '[Tasks]', 'List', 'Calendar', 'Review', 'Planner', 'Notes',
      '—', '[Insights]', 'Number', 'Breakdown', 'Pivot', 'Created vs completed', 'Neglect map', 'Work clusters', 'List wall',
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

describe('Move / Copy to layout entries', () => {
  const transfer = (onPick = vi.fn()) => ({
    layouts: [
      { id: 1, name: 'A', current: true },
      { id: 2, name: 'B', current: false },
    ],
    onPick,
  })

  it('the ⋯ lists Move to layout and Copy to layout after the widget entries, before Add widget as tab', () => {
    const entries = cellMenuFor([], actions({ transfer: transfer() }))
    const w = words(entries)
    expect(w).toContain('Move to layout')
    expect(w.indexOf('Copy to layout')).toBe(w.indexOf('Move to layout') + 1)
    expect(w.indexOf('Copy to layout')).toBeLessThan(w.indexOf('Add widget as tab'))
  })

  it('no entries without a transfer menu', () => {
    const w = words(cellMenuFor([], actions()))
    expect(w).not.toContain('Move to layout')
    expect(w).not.toContain('Copy to layout')
    expect(words(editCardMenuEntries(cardActions()))).not.toContain('Move cell to layout')
  })

  it('each submenu lists the layouts, the open one off with a note, then New layout…', () => {
    const entries = cellMenuFor([], actions({ transfer: transfer() }))
    const kids = childrenOf(entries, 'Move to layout')
    expect(words(kids)).toEqual(['A', 'B', '—', 'New layout…'])
    const current = kids[0]
    expect(current?.kind === 'item' && current.disabled).toBe(true)
    expect(current?.kind === 'item' && current.note).toBe('this layout')
    const other = kids[1]
    expect(other?.kind === 'item' && other.disabled).toBeFalsy()
  })

  it('a pick calls onPick with the layout id and whether it is a copy; New layout… with "new"', () => {
    const onPick = vi.fn()
    const entries = cellMenuFor([], actions({ transfer: transfer(onPick) }))
    select(item(childrenOf(entries, 'Move to layout'), 'B'))
    expect(onPick).toHaveBeenLastCalledWith(2, false)
    select(item(childrenOf(entries, 'Copy to layout'), 'B'))
    expect(onPick).toHaveBeenLastCalledWith(2, true)
    select(item(childrenOf(entries, 'Copy to layout'), 'New layout…'))
    expect(onPick).toHaveBeenLastCalledWith('new', true)
    select(item(childrenOf(entries, 'Move to layout'), 'New layout…'))
    expect(onPick).toHaveBeenLastCalledWith('new', false)
  })

  it('the card menu has Move cell to layout and Copy cell to layout between Stretch down and Remove widget', () => {
    const onPick = vi.fn()
    const entries = editCardMenuEntries(cardActions({ transfer: transfer(onPick) }))
    const w = words(entries)
    expect(w.indexOf('Move cell to layout')).toBeGreaterThan(w.indexOf('Stretch down'))
    expect(w.indexOf('Copy cell to layout')).toBeLessThan(w.indexOf('Remove widget'))
    select(item(childrenOf(entries, 'Copy cell to layout'), 'B'))
    expect(onPick).toHaveBeenCalledWith(2, true)
    select(item(childrenOf(entries, 'Move cell to layout'), 'New layout…'))
    expect(onPick).toHaveBeenLastCalledWith('new', false)
  })
})
