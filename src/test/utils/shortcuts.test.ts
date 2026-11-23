import { describe, expect, it } from 'vitest'
import { emptyPredicate } from '../../models/filter-predicate'
import type { PersistedListDefinition } from '../../models/list-definition'
import { createTab, type PersistedWorkspaceLayout } from '../../models/workspace-layout'
import {
  compactShortcutTiles,
  shortcutChoices,
  shortcutLayoutName,
  shortcutListIcon,
  shortcutPeekLines,
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
const lens = (id: string, listDefinitionId: number) => ({ ...createTab('lens', id), config: { listDefinitionId } })

const home: PersistedWorkspaceLayout = {
  id: 1, name: 'Home', sortOrder: 1, createdAt: AT, modifiedAt: AT,
  ...grid([[cell('a', [{ ...lens('t1', 1), icon: { kind: 'line', key: 'flag' } }]), cell('b', [lens('t3', 3)])]]),
}
const work: PersistedWorkspaceLayout = {
  id: 2, name: 'Work', sortOrder: 0, createdAt: AT, modifiedAt: AT,
  ...single(cell('w', [lens('t2', 2), { ...lens('t1-copy', 1), icon: { kind: 'emoji', emoji: '🌿' } }])),
}

describe('Shortcuts’ lists', () => {
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

  it('a list’s icon: its own layout’s tab’s picked one, else another layout’s; its layout’s name (the open one as edited)', () => {
    expect(shortcutListIcon(def(1, 'Errands', 1), [work, home], home)).toEqual({ kind: 'line', key: 'flag' })
    // Its own layout shows it on no tab: the tab elsewhere.
    expect(shortcutListIcon(def(1, 'Errands', 3), [work, home], home)).toEqual({ kind: 'emoji', emoji: '🌿' })
    // A tab with no icon picked, and no tab at all: none.
    expect(shortcutListIcon(def(2, 'Clients', 2), [work, home], home)).toBeUndefined()
    expect(shortcutListIcon(def(9, 'Gone', 2), [work, home], home)).toBeUndefined()
    expect(shortcutLayoutName(def(1, 'Errands', 1), [work, home], { ...home, name: 'Home (renamed)' })).toBe('Home (renamed)')
    expect(shortcutLayoutName(def(2, 'Clients', 2), [work, home], home)).toBe('Work')
  })

  it('the compact line: as many 150px tiles as fit, the rest in +N', () => {
    expect(compactShortcutTiles(2, 900)).toEqual({ columns: 5, shown: 2, more: 0 })
    expect(compactShortcutTiles(6, 470)).toEqual({ columns: 3, shown: 2, more: 4 })
    expect(compactShortcutTiles(3, 0)).toEqual({ columns: 3, shown: 3, more: 0 })
  })

  it('peek lines: as many whole 16px lines as the height holds, three at most', () => {
    expect(shortcutPeekLines(1)).toBe(0)
    expect(shortcutPeekLines(33)).toBe(2)
    expect(shortcutPeekLines(200)).toBe(3)
    expect(shortcutPeekLines(0)).toBe(3)
  })
})

describe('Shortcuts’ faces', () => {
  it('small, rows (narrow), compact (short), large', () => {
    const shape = (width: number, height: number) => shortcutsShape(shortcutsFaceFor({ width, height }), width)
    expect(shape(170, 400)).toBe('small')
    expect(shape(600, 80)).toBe('small')
    expect(shape(300, 400)).toBe('rows')
    expect(shape(300, 140)).toBe('rows')
    expect(shape(600, 140)).toBe('compact')
    expect(shape(600, 400)).toBe('large')
    expect(shape(0, 0)).toBe('large')
    // The popup forces large.
    expect(shortcutsShape('large', 300)).toBe('large')
  })
})
