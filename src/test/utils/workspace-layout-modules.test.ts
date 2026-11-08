import { describe, it, expect } from 'vitest'
import * as edit from '../../utils/workspace-layout-edit'
import * as lists from '../../utils/workspace-layout-lists'
import * as ops from '../../utils/workspace-layout-ops'
import * as queries from '../../utils/workspace-layout-queries'
import * as sizes from '../../utils/workspace-layout-sizes'

/**
 * `utils/workspace-layout-ops` split along its seams (cr33 A10): the
 * reducers, the location queries, the list refs and the sizes, over the
 * setters they share. A pure move — every function the one module exported
 * is exported by exactly one of them.
 */

const MODULES = { edit, lists, ops, queries, sizes }

/** Every function `workspace-layout-ops` exported before the split. */
const BEFORE = [
  'addTab', 'cellAt', 'cellSizeGroups', 'closeCell', 'closeTab', 'copySizes', 'countListTabs', 'extractTab', 'findCell', 'findRow',
  'findTab', 'getTab', 'layoutIds', 'layoutListRefs', 'layoutPanels', 'layoutRows', 'layoutStructureEqual', 'layoutStructureKey',
  'layoutTabs', 'listIdChanges', 'movePanel', 'moveTab', 'panelOfTab', 'patchTabConfig', 'patchTabViewState', 'repointLayoutLists',
  'replaceTab', 'rowAt', 'rowOfCell', 'rowSizeGroups', 'setActiveTab', 'setBandHeight', 'setCellStripShown', 'setCellWeights',
  'setColumnWeights', 'setLayoutActiveColumn', 'setLayoutHue', 'setRowCollapsed', 'setRowWeights', 'splitCell',
]

describe('the layout modules (A10)', () => {
  it('every function the old module exported lives in exactly one of them', () => {
    for (const name of BEFORE) {
      const homes = Object.entries(MODULES).filter(([, m]) => typeof (m as Record<string, unknown>)[name] === 'function').map(([k]) => k)
      expect(homes, name).toHaveLength(1)
    }
  })

  it('each seam holds its own kind: queries read, lists name lists, sizes size, ops reduce', () => {
    expect(Object.keys(queries).sort()).toEqual([
      'cellAt', 'findCell', 'findRow', 'findTab', 'getTab', 'layoutIds', 'layoutPanels', 'layoutRows', 'layoutStructureEqual',
      'layoutStructureKey', 'layoutTabs', 'panelOfTab', 'rowAt', 'rowLocOf', 'rowOfCell',
    ])
    expect(Object.keys(lists).sort()).toEqual(['countListTabs', 'layoutListRefs', 'listIdChanges', 'repointLayoutLists'])
    expect(Object.keys(sizes).sort()).toEqual(['cellSizeGroups', 'copySizes', 'rowSizeGroups', 'setBandHeight', 'setCellWeights', 'setColumnWeights', 'setRowWeights'])
    expect(Object.keys(ops)).not.toContain('findCell')
    expect(Object.keys(edit).sort()).toEqual([
      'expanded', 'insertAllAt', 'insertAt', 'isPositive', 'removeAt', 'replaceAt', 'setCellAt', 'setColumnRow', 'setRowAt', 'withBand', 'withColumns',
    ])
  })
})
