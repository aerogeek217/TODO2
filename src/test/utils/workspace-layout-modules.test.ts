import { describe, it, expect } from 'vitest'
import * as edit from '../../utils/workspace-layout-edit'
import * as lists from '../../utils/workspace-layout-lists'
import * as ops from '../../utils/workspace-layout-ops'
import * as queries from '../../utils/workspace-layout-queries'
import * as sizes from '../../utils/workspace-layout-sizes'

/**
 * The layout modules split along their seams (cr33 A10; the table, D26):
 * the reducers, the queries, the list refs and the sizes, over the setters
 * they share. Every function is exported by exactly one of them.
 */

const MODULES = { edit, lists, ops, queries, sizes }

/** Every function the layout modules export (bar the shared setters). */
const ALL = [
  'addTab', 'cellRowTracks', 'closeCell', 'closeTab', 'copySizes', 'countListTabs', 'extractTab', 'findCell', 'findTab', 'getTab',
  'insertTrack', 'isCellCollapsed', 'layoutIds', 'layoutListRefs', 'layoutPanels', 'layoutStructureEqual', 'layoutStructureKey',
  'layoutTabs', 'listIdChanges', 'mergeCells', 'moveEdge', 'movePanel', 'moveTab', 'panelOfTab', 'patchTabConfig', 'patchTabViewState',
  'repointLayoutLists', 'replaceTab', 'setActiveTab', 'setLayoutHue', 'setTrackCollapsed', 'setTrackSizes', 'splitCell', 'trackAxes',
]

describe('the layout modules (A10)', () => {
  it('every function lives in exactly one of them', () => {
    for (const name of ALL) {
      const homes = Object.entries(MODULES).filter(([, m]) => typeof (m as Record<string, unknown>)[name] === 'function').map(([k]) => k)
      expect(homes, name).toHaveLength(1)
    }
  })

  it('each seam holds its own kind: queries read, lists name lists, sizes size, ops reduce', () => {
    expect(Object.keys(queries).sort()).toEqual([
      'findCell', 'findTab', 'getTab', 'layoutIds', 'layoutPanels', 'layoutStructureEqual', 'layoutStructureKey', 'layoutTabs', 'panelOfTab', 'sameArrangement',
    ])
    expect(Object.keys(lists).sort()).toEqual(['countListTabs', 'layoutListRefs', 'listIdChanges', 'repointLayoutLists'])
    expect(Object.keys(sizes).sort()).toEqual(['GRID_AXES', 'copySizes', 'setTrackSizes', 'trackAxes'])
    expect(Object.keys(ops)).not.toContain('findCell')
    expect(Object.keys(edit).sort()).toEqual(['insertAllAt', 'insertAt', 'isPositive', 'removeAt', 'replaceAt', 'setCell', 'withCells', 'withTracks'])
  })
})
