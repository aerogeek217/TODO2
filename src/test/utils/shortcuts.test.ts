import { describe, expect, it } from 'vitest'
import { emptyPredicate } from '../../models/filter-predicate'
import type { PersistedListDefinition } from '../../models/list-definition'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import {
  boardTileRoom,
  boardLines,
  boardMinHeight,
  boardTileMinWidth,
  layoutListTabs,
  shortcutChoices,
  shortcutLayoutName,
  shortcutListIcon,
  shortcutsSource,
  tabIsShowing,
  withShortcutAdded,
  withShortcutMoved,
  withShortcutRemoved,
} from '../../utils/shortcuts'
import { shortcutsFaceFor, shortcutsShape } from '../../utils/widget-face'
import { cell, grid, single } from '../helpers/layout-builders'

const AT = new Date(0)
const def = (id: number, name: string, layoutId: number, sortOrder = id): PersistedListDefinition => ({
  id, name, sortOrder, owner: { layoutId }, membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
})
// A list tab with no icon stored (an icon is spread in where a test gives one).
const lens = (id: string, listDefinitionId: number) => {
  const { icon: _icon, ...tab } = createTab('lens', id, { listDefinitionId })
  void _icon
  return tab
}

const home: PersistedWorkspaceLayout = {
  id: 1, name: 'Home', sortOrder: 1, createdAt: AT, modifiedAt: AT,
  ...grid([[cell('a', [{ ...lens('t1', 1), icon: { kind: 'line', key: 'flag' } }]), cell('b', [lens('t3', 3)])]]),
}
const work: PersistedWorkspaceLayout = {
  id: 2, name: 'Work', sortOrder: 0, createdAt: AT, modifiedAt: AT,
  ...single(cell('w', [lens('t2', 2), { ...lens('t1-copy', 1), icon: { kind: 'emoji', emoji: '🌿' } }])),
}

describe('a List board’s picked lists', () => {
  it('adds at the end (once), removes, moves', () => {
    expect(withShortcutAdded([1, 2], 3)).toEqual([1, 2, 3])
    expect(withShortcutAdded([1, 2], 2)).toEqual([1, 2])
    expect(withShortcutRemoved([1, 2, 3], 2)).toEqual([1, 3])
    expect(withShortcutMoved([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    expect(withShortcutMoved([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(withShortcutMoved([1, 2, 3], 0, 5)).toEqual([1, 2, 3])
  })

  it('Add a list: every list not added, under its layout, the open layout first, each layout’s lists in order', () => {
    const defs = [def(4, 'Later', 2, 9), def(2, 'Clients', 2, 1), def(1, 'Errands', 1), def(3, 'Bills', 1), def(5, 'Held', 1)]
    const groups = shortcutChoices(defs, [work, home], home, [3], new Set([5]))
    expect(groups.map((g) => [g.layoutName, g.lists.map((d) => d.name)])).toEqual([
      ['Home', ['Errands']],
      ['Work', ['Clients', 'Later']],
    ])
    // A layout with nothing left to add has no heading.
    expect(shortcutChoices(defs, [work, home], home, [1, 3, 5]).map((g) => g.layoutName)).toEqual(['Work'])
  })

  it('a list’s icon: the one stored on its own layout’s tab, else another layout’s; its layout’s name (the open one as edited)', () => {
    expect(shortcutListIcon(def(1, 'Errands', 1), [work, home], home)).toEqual({ kind: 'line', key: 'flag' })
    // Its own layout shows it on no tab: the tab elsewhere.
    expect(shortcutListIcon(def(1, 'Errands', 3), [work, home], home)).toEqual({ kind: 'emoji', emoji: '🌿' })
    // A tab with no icon stored, and no tab at all: no icon, as the strip shows none.
    expect(shortcutListIcon(def(2, 'Clients', 2), [work, home], home)).toBeUndefined()
    expect(shortcutListIcon(def(9, 'Gone', 2), [work, home], home)).toBeUndefined()
    // The list glyph stored on a tab shows as any icon does.
    const glyphed = { ...work, ...single(cell('w', [{ ...lens('t2', 2), icon: { kind: 'line', key: 'list' } }])) } as PersistedWorkspaceLayout
    expect(shortcutListIcon(def(2, 'Clients', 2), [glyphed, home], home)).toEqual({ kind: 'line', key: 'list' })
    expect(shortcutLayoutName(def(1, 'Errands', 1), [work, home], { ...home, name: 'Home (renamed)' })).toBe('Home (renamed)')
    expect(shortcutLayoutName(def(2, 'Clients', 2), [work, home], home)).toBe('Work')
  })

  it('the tiles: one width, the widest head’s (120px to 280px); the lines they wrap onto; the row’s least height', () => {
    expect(boardTileMinWidth([])).toBe(120)
    expect(boardTileMinWidth([90, 171.2, 140])).toBe(172)
    expect(boardTileMinWidth([400])).toBe(280)
    // 172px tiles with 8px gaps: five across 992px; six wrap onto two lines; nothing measured, one line.
    expect(boardLines(5, 992, 172)).toBe(1)
    expect(boardLines(6, 992, 172)).toBe(2)
    expect(boardLines(6, 360, 172)).toBe(3)
    expect(boardLines(0, 992, 172)).toBe(1)
    // One line of heads is the lone board's least (63px); each more line adds a head and a gap.
    expect(boardMinHeight(1)).toBe(63)
    expect(boardMinHeight(3)).toBe(63 + 2 * 53)
  })

  it('a tile’s room: squares first (whole 12px rows, four at most), then titles in what is left', () => {
    // 112px across: 9 squares a row; 20 squares want 3 rows (34px), a 6px gap and three 16px titles.
    expect(boardTileRoom(20, 5, { width: 112, height: 200 })).toEqual({ columns: 9, rows: 3, lines: 3, want: 88 })
    // Shorter: the titles go first…
    expect(boardTileRoom(20, 5, { width: 112, height: 60 })).toMatchObject({ rows: 3, lines: 1 })
    expect(boardTileRoom(20, 5, { width: 112, height: 40 })).toMatchObject({ rows: 3, lines: 0 })
    // …then the rows of squares.
    expect(boardTileRoom(20, 5, { width: 112, height: 22 })).toMatchObject({ rows: 2, lines: 0 })
    expect(boardTileRoom(20, 5, { width: 112, height: 4 })).toMatchObject({ rows: 0, lines: 0 })
    // A big list stops at four rows (its +N); no squares, only titles; no titles asked for.
    expect(boardTileRoom(200, 5, { width: 112, height: 400 })).toMatchObject({ rows: 4, lines: 3, want: 46 + 6 + 48 })
    expect(boardTileRoom(0, 2, { width: 112, height: 400 })).toEqual({ columns: 9, rows: 0, lines: 2, want: 32 })
    expect(boardTileRoom(20, 5, { width: 112, height: 400 }, false)).toEqual({ columns: 9, rows: 3, lines: 0, want: 34 })
    // Unmeasured: 9 across, all of it.
    expect(boardTileRoom(20, 5, { width: 0, height: 0 })).toMatchObject({ columns: 9, rows: 3, lines: 3 })
  })
})

describe('the layout’s lists', () => {
  it('every list tab whose list exists, in reading order (by cell, then strip order); whether its cell shows it', () => {
    const lens = (id: string, listDefinitionId?: number) => ({ ...createTab('lens', id), config: listDefinitionId != null ? { listDefinitionId } : {} })
    const body = grid([
      [cell('a', [lens('t1', 1), createTab('notes', 'n'), lens('t2', 2)], { activeTabId: 't2' }), cell('b', [lens('t3', 3), lens('t4')])],
      [cell('c', [lens('t5', 9), lens('t6', 1)]), cell('b')],
    ])
    expect(layoutListTabs(body, (id) => id !== 9).map((t) => t.id)).toEqual(['t1', 't2', 't3', 't6'])
    expect(tabIsShowing(body, 't2')).toBe(true)
    expect(tabIsShowing(body, 't1')).toBe(false)
    expect(tabIsShowing(body, 't3')).toBe(true)
  })

  it('a board’s source: absent is the lists picked', () => {
    expect(shortcutsSource({})).toBe('picked')
    expect(shortcutsSource({ source: 'layout', lists: [1] })).toBe('layout')
  })
})

describe('the List board’s faces', () => {
  it('small, rows (narrow), compact (short), large', () => {
    const shape = (width: number, height: number) => shortcutsShape(shortcutsFaceFor({ width, height }), width)
    expect(shape(170, 400)).toBe('small')
    // Wide, its line of tiles holds down to a tile's head (63px), under the small face's 90.
    expect(shape(600, 80)).toBe('compact')
    expect(shape(600, 63)).toBe('compact')
    expect(shape(600, 62)).toBe('small')
    expect(shape(300, 80)).toBe('small')
    expect(shape(300, 400)).toBe('rows')
    expect(shape(300, 140)).toBe('rows')
    expect(shape(600, 140)).toBe('compact')
    expect(shape(600, 400)).toBe('large')
    expect(shape(0, 0)).toBe('large')
    // The popup forces large.
    expect(shortcutsShape('large', 300)).toBe('large')
  })
})
