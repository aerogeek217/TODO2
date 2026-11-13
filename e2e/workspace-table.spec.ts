import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  drag,
  dragPanel,
  dragTab,
  edges,
  expectSameEdges,
  openCellLayoutMenu,
  openCellMenu,
  pickCellMenu,
  releaseDrag,
  seedWorkspace,
  wsCell,
  wsDivider,
  wsGhost,
  wsListWidget,
  wsPanelHandle,
  wsShape,
  wsTab,
  type WsLayoutSeed,
  expectDividerStep, expectLayoutStep,
  expectLayoutStored,
} from './fixtures/workspace'
import { box, expectInsideViewport, pointIn, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * The layout's table in a real browser (D26 P2): a drop on each side of a
 * cell, at the layout's edges (Insert row / column), into a cell and on its
 * strip, each previewed by one labelled ghost that matches the cell the drop
 * makes (within 2px); whole-cell drags; Merge with, Insert, Close with and
 * without a taker; dividers over a whole line (view state, kept over a
 * reload) and over part of one (a new line, unsaved); the minimums and the
 * sideways scroll; a fixed (former band) row; a fit row of Numbers; and
 * Collapse row.
 */


/** `a b / c b`: a (Notes, Neglect map) over c (Notes), b (Calendar) down the right. */
const aBc: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b', 'c b'],
    cells: [
      { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'mapTab', kind: 'neglect' }] },
      { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
      { id: 'c', tabs: [{ id: 'notes2', kind: 'notes' }] },
    ],
  },
}

/** The cell now holding tab `tabId`. */
function cellOf(page: Page, tabId: string): Locator {
  return page.locator(`[data-ws-cell]:has([data-ws-tab="${tabId}"])`)
}

function bodyPoint(page: Page, cellId: string, fx: number, fy: number): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), fx, fy)
}

async function areaBox(page: Page) {
  return box(page.locator('[data-ws-area]'))
}

/**
 * Drags tab `tabId` to `to`, checking the ghost's label while over it, and
 * returns the ghost's edges as drawn there.
 */
async function dragWithGhost(page: Page, tabId: string, to: Point, label: string) {
  let ghost = { left: 0, top: 0, right: 0, bottom: 0 }
  await dragTab(page, wsTab(page, tabId), to, async () => {
    await expect(wsGhost(page)).toBeVisible()
    await expect(page.getByTestId('ws-drop-label')).toHaveText(label)
    // Hidden from assistive tech: its layer is.
    await expect(wsGhost(page).locator('xpath=..')).toHaveAttribute('aria-hidden', 'true')
    ghost = await edges(wsGhost(page))
  })
  return ghost
}

test.describe('drops and the ghost', () => {
  const sides = [
    { side: 'left', at: [0.05, 0.5], label: 'Split Calendar · left', shape: [[['notesTab'], ['notes2']], [['mapTab']], [['calTab']]] },
    { side: 'right', at: [0.95, 0.5], label: 'Split Calendar · right', shape: [[['notesTab'], ['notes2']], [['calTab']], [['mapTab']]] },
    { side: 'top', at: [0.5, 0.05], label: 'Split Calendar · above', shape: [[['notesTab'], ['notes2']], [['mapTab'], ['calTab']]] },
    { side: 'bottom', at: [0.5, 0.95], label: 'Split Calendar · below', shape: [[['notesTab'], ['notes2']], [['calTab'], ['mapTab']]] },
  ] as const
  for (const { side, at, label, shape } of sides) {
    test(`a tab on a cell’s ${side} edge splits it; the ghost is the new cell’s place and size`, async ({ page }) => {
      await seedWorkspace(page, { layouts: [aBc] })
      const ghost = await dragWithGhost(page, 'mapTab', await bodyPoint(page, 'b', at[0], at[1]), label)
      await expect.poll(() => wsShape(page)).toEqual(shape)
      expectSameEdges(ghost, await edges(cellOf(page, 'mapTab')))
      await expectLayoutStep(page)
    })
  }

  test('the layout’s top edge inserts a full-width row; its right edge a full-height column', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const a = await areaBox(page)
    const row = await dragWithGhost(page, 'mapTab', { x: a.x + 300, y: a.y + 3 }, 'Insert row · full width')
    await expect.poll(async () => Math.round((await box(cellOf(page, 'mapTab'))).width)).toBe(Math.round(a.width - 12))
    expectSameEdges(row, await edges(cellOf(page, 'mapTab')))

    const col = await dragWithGhost(page, 'notes2', { x: a.x + a.width - 8, y: a.y + a.height / 2 }, 'Insert column · full height')
    await expect.poll(async () => Math.round((await box(cellOf(page, 'notes2'))).height)).toBe(Math.round(a.height - 12))
    expectSameEdges(col, await edges(cellOf(page, 'notes2')))
  })

  test('the middle of a cell joins it as a tab (ghost tab in its strip); its strip inserts at the line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const ghost = await dragWithGhost(page, 'mapTab', await bodyPoint(page, 'b', 0.5, 0.5), 'Add as tab')
    expectSameEdges(ghost, await edges(wsCell(page, 'b')))
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab'], ['notes2']], [['calTab', 'mapTab']]])

    const cal = await box(wsTab(page, 'calTab'))
    await dragTab(page, wsTab(page, 'notesTab'), { x: cal.x + 10, y: cal.y + cal.height / 2 }, async () => {
      await expect(wsCell(page, 'b').getByTestId('ws-tab-insert-line')).toBeVisible()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notes2']], [['notesTab', 'calTab', 'mapTab']]])
  })

  test('a drop that changes nothing shows no ghost; Escape cancels', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    await dragTab(page, wsTab(page, 'calTab'), await bodyPoint(page, 'b', 0.5, 0.5), async () => {
      await expect(wsGhost(page)).toHaveCount(0)
    })
    await expectLayoutStored(page)

    const t = await box(wsTab(page, 'mapTab'))
    const to = await bodyPoint(page, 'b', 0.5, 0.5)
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2)
    await page.mouse.down()
    await page.mouse.move(t.x + 20, t.y + 20, { steps: 2 })
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await expect(wsGhost(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await releaseDrag(page)
    await expect(wsGhost(page)).toHaveCount(0)
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'mapTab'], ['notes2']], [['calTab']]])
    await expectLayoutStored(page)
  })
})

test.describe('whole-cell drags', () => {
  test('the header’s grip shows on header hover without moving anything; a press without travel moves nothing', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const handle = wsPanelHandle(page, 'a')
    const grip = page.locator('[data-ws-cell-header="a"]').getByRole('button', { name: 'Cell layout' })
    const before = await box(wsTab(page, 'mapTab'))
    await page.mouse.move(2, 2)
    await expect.poll(() => grip.evaluate((e) => getComputedStyle(e.parentElement!).opacity)).toBe('0')
    await handle.hover()
    await expect.poll(() => grip.evaluate((e) => getComputedStyle(e.parentElement!).opacity)).toBe('1')
    await expect(grip).toHaveCSS('cursor', 'grab')
    await expect(handle).toHaveCSS('cursor', 'grab')
    expect(await box(wsTab(page, 'mapTab'))).toEqual(before)
    const p = await pointIn(handle)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 3, p.y, { steps: 2 })
    await expect(page.getByTestId('ws-panel-ghost')).toHaveCount(0)
    await page.mouse.up()
    await expectLayoutStored(page)
  })

  test('a cell into another’s middle: all its tabs join, the first moved one active', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    await dragPanel(page, 'a', await bodyPoint(page, 'c', 0.5, 0.5), {
      lifted: async () => {
        await expect(wsCell(page, 'a')).toHaveCSS('opacity', '0.4')
        await expect(page.getByTestId('ws-panel-ghost')).toContainText('2 tabs')
      },
      during: async () => {
        await expect(page.getByTestId('ws-drop-label')).toHaveText('Add 2 tabs')
        await expect(wsCell(page, 'c').getByTestId('ws-ghost-tab')).toHaveCount(2)
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notes2', 'notesTab', 'mapTab']], [['calTab']]])
    await expect(wsTab(page, 'notesTab')).toHaveAttribute('aria-selected', 'true')
  })

  test('a cell onto another’s edge: its old place goes to its neighbour, the ghost shows the result', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    let ghost = { left: 0, top: 0, right: 0, bottom: 0 }
    await dragPanel(page, 'c', await bodyPoint(page, 'b', 0.95, 0.5), {
      during: async () => {
        await expect(page.getByTestId('ws-drop-label')).toHaveText('Split Calendar · right')
        ghost = await edges(wsGhost(page))
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'mapTab']], [['calTab']], [['notes2']]])
    expectSameEdges(ghost, await edges(cellOf(page, 'notes2')))
  })

  test('over its own cell nothing lights up; near the window’s bottom the ghost card flips above the pointer', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    await dragPanel(page, 'b', await bodyPoint(page, 'b', 0.5, 0.5), {
      during: async () => { await expect(wsGhost(page)).toHaveCount(0) },
    })
    await expectLayoutStored(page)
    const a = await areaBox(page)
    const to = { x: a.x + 300, y: a.y + a.height - 3 }
    await dragPanel(page, 'a', to, {
      during: async () => {
        await expect(page.getByTestId('ws-drop-label')).toHaveText('Insert row · full width')
        const card = await box(page.getByTestId('ws-panel-ghost'))
        expect(card.y + card.height).toBeLessThanOrEqual(to.y)
        await expectInsideViewport(page, page.getByTestId('ws-panel-ghost'), 0)
      },
    })
    await expect.poll(async () => Math.round((await box(cellOf(page, 'mapTab'))).width)).toBe(Math.round(a.width - 12))
  })
})

test.describe('the cell menu', () => {
  test('Merge with ▸ Below joins the cell under it (Right is off: no rectangle); Insert ▸ Row at the top', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    await openCellLayoutMenu(page, 'a')
    await page.getByRole('menuitem', { name: 'Merge with', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Right', exact: true })).toBeDisabled()
    await page.getByRole('menuitem', { name: 'Below', exact: true }).click()
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'mapTab', 'notes2']], [['calTab']]])
    await expectLayoutStep(page)

    await openCellLayoutMenu(page, 'b')
    await pickCellMenu(page, 'Insert', 'Row at the top')
    const empty = page.getByRole('region', { name: 'Empty cell' })
    await expect(empty).toBeVisible()
    const a = await areaBox(page)
    expect(Math.round((await box(empty)).width)).toBe(Math.round(a.width - 12))
  })

  test('Close cell gives its place to a neighbour sharing its whole edge; with none it stays an empty cell', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const area = await areaBox(page)
    await openCellLayoutMenu(page, 'c')
    await page.getByRole('menuitem', { name: 'Close cell', exact: true }).click()
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a'))).height)).toBe(Math.round(area.height - 12))

    // A pinwheel: the middle cell shares no whole edge with any other.
    await seedWorkspace(page, {
      layouts: [{
        name: 'Pinwheel',
        table: {
          areas: ['p p q', 's m q', 's r r'],
          cells: ['p', 'q', 's', 'm', 'r'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
        },
      }],
    })
    const before = await edges(wsCell(page, 'm'))
    await openCellLayoutMenu(page, 'm')
    await page.getByRole('menuitem', { name: 'Close cell', exact: true }).click()
    const empty = page.getByRole('region', { name: 'Empty cell' })
    await expect(empty).toBeVisible()
    expectSameEdges(await edges(empty), before)
    await expect(wsCell(page, 'm')).toHaveAttribute('data-empty', 'true')
  })

  test('Add widget… puts the widget where it says: Right of the cell', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    await openCellMenu(page, 'c')
    await page.getByRole('menuitem', { name: 'Add widget…' }).click()
    const menu = page.getByRole('menu', { name: 'Add widget' })
    await menu.getByRole('group', { name: 'Where' }).getByRole('menuitemradio', { name: 'Split · right' }).click()
    await menu.getByRole('menuitem', { name: 'Notes', exact: true }).click()
    await expect.poll(async () => (await wsShape(page)).length).toBe(3)
    const c = await box(wsCell(page, 'c'))
    const added = page.locator('[data-ws-cell]').filter({ hasNot: page.locator('[data-ws-tab="notesTab"], [data-ws-tab="calTab"], [data-ws-tab="notes2"]') })
    const n = await box(added)
    expect(Math.round(n.y)).toBe(Math.round(c.y))
    expect(n.x).toBeGreaterThan(c.x + c.width)
  })
})

test.describe('dividers', () => {
  test('a whole line resizes its two tracks — view state, kept over a reload — and stops at 120px', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const a = wsCell(page, 'a')
    const before = (await box(a)).width
    const divider = wsDivider(page, 'a', 'b')
    await expect(divider).toHaveAccessibleName('Resize Notes and Calendar')
    // c borders the same line, at a "T": one divider for the whole of it.
    await expect(page.locator('[data-ws-divider][data-axis="columns"]')).toHaveCount(1)
    const d = await box(divider)
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 + 100, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round((await box(a)).width - before)).toBeGreaterThan(90)
    await expectLayoutStored(page)
    const resized = Math.round((await box(a)).width)
    expect(Math.round((await box(wsCell(page, 'c'))).width)).toBe(resized)
    await expect.poll(async () => {
      const stored = (await readStore<{ grid: { columns: Array<{ weight: number }> } }>(page, 'layouts'))[0]
      const [c1, c2] = stored?.grid.columns ?? []
      return (c1?.weight ?? 0) > (c2?.weight ?? 0)
    }).toBe(true)
    await page.reload()
    await expect.poll(async () => Math.round((await box(a)).width)).toBe(resized)

    // The keyboard steps it 16px.
    await divider.focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(async () => Math.round((await box(a)).width)).toBe(resized - 16)

    // Far left: the cells stop at their 120px.
    const d2 = await box(divider)
    await drag(page, { x: d2.x + d2.width / 2, y: d2.y + d2.height / 2 }, { x: 0, y: d2.y + d2.height / 2 })
    await expect.poll(async () => Math.round((await box(a)).width)).toBe(120)
  })

  test('part of a line previews where it goes, and on release makes a new line (unsaved); Save keeps it', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['a c x', 'b c y'],
          cells: ['a', 'b', 'c', 'x', 'y'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
        },
      }],
    })
    const divider = wsDivider(page, 'a', 'b')
    const xBottom = (await edges(wsCell(page, 'x'))).bottom
    const aBox = await edges(wsCell(page, 'a'))
    const d = await box(divider)
    const from = { x: d.x + d.width / 2, y: d.y + d.height / 2 }
    let mid = { a: 0, b: 0 }
    await drag(page, from, { x: from.x, y: from.y + 100 }, {
      during: async () => {
        await expect(divider).toHaveAttribute('data-preview', '')
        // The cells already stand where the release puts them.
        await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - aBox.bottom)).toBeGreaterThan(90)
        mid = { a: (await edges(wsCell(page, 'a'))).bottom, b: (await edges(wsCell(page, 'b'))).top }
      },
    })
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - aBox.bottom)).toBeGreaterThan(90)
    expect(Math.abs((await edges(wsCell(page, 'a'))).bottom - mid.a)).toBeLessThanOrEqual(1)
    expect(Math.abs((await edges(wsCell(page, 'b'))).top - mid.b)).toBeLessThanOrEqual(1)
    // x and y keep their line.
    // (A new track takes one more gap from the weighted rows: a few px.)
    expect(Math.abs((await edges(wsCell(page, 'x'))).bottom - xBottom)).toBeLessThanOrEqual(4)
    await expectDividerStep(page)
    const moved = Math.round((await edges(wsCell(page, 'a'))).bottom)
    await expectLayoutStored(page)
    await page.reload()
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom)).toBe(moved)
  })

  test('a fixed row (a former band) keeps its px; its divider sets them, saved at once', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['t t', 'a b'],
          rows: [{ px: 160 }, 1000],
          cells: [
            { id: 't', tabs: [{ id: 'topNotes', kind: 'notes' }] },
            { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
            { id: 'b', tabs: [{ id: 'bTab', kind: 'notes' }] },
          ],
        },
      }],
    })
    await expect.poll(async () => Math.round((await box(wsCell(page, 't'))).height)).toBe(160)
    const d = await box(wsDivider(page, 't', 'a'))
    await drag(page, { x: d.x + 300, y: d.y + d.height / 2 }, { x: d.x + 300, y: d.y + d.height / 2 + 40 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 't'))).height)).toBe(200)
    await expectLayoutStored(page)
    await expect.poll(async () => (await readStore<{ grid: { rows: Array<{ px?: number }> } }>(page, 'layouts'))[0]?.grid.rows[0]?.px).toBe(200)
  })

  /** `a b / e e / c d`, the column line at 600 : 400: a|b and c|d are parts of one line. */
  const partLines: WsLayoutSeed = {
    name: 'Main',
    table: {
      areas: ['a b', 'e e', 'c d'],
      cols: [600, 400],
      cells: ['a', 'b', 'e', 'c', 'd'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
    },
  }

  test('the keyboard on part of a line keeps the focus while it moves, press after press', async ({ page }) => {
    await seedWorkspace(page, { layouts: [partLines] })
    const divider = wsDivider(page, 'a', 'b')
    const aWidth = Math.round((await box(wsCell(page, 'a'))).width)
    const cWidth = Math.round((await box(wsCell(page, 'c'))).width)
    await divider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(divider).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(divider).toBeFocused()
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a'))).width - aWidth)).toBeGreaterThanOrEqual(30)
    // c|d stays where it was (a new track takes one more gap from the weighted columns: a few px).
    expect(Math.abs(Math.round((await box(wsCell(page, 'c'))).width) - cWidth)).toBeLessThanOrEqual(4)
  })

  test('a double-click on part of a line evens only its own cells; the rest of the line stays', async ({ page }) => {
    await seedWorkspace(page, { layouts: [partLines] })
    const cWidth = Math.round((await box(wsCell(page, 'c'))).width)
    const d = await box(wsDivider(page, 'a', 'b'))
    await page.mouse.dblclick(d.x + d.width / 2, d.y + d.height / 2)
    // Even within one gutter: the new line's track brings a gap inside a.
    await expect.poll(async () => Math.abs(Math.round((await box(wsCell(page, 'a'))).width - (await box(wsCell(page, 'b'))).width))).toBeLessThanOrEqual(8)
    // c|d stays at 600 : 400 (a new track takes one more gap: a few px).
    expect(Math.abs(Math.round((await box(wsCell(page, 'c'))).width) - cWidth)).toBeLessThanOrEqual(4)
    await expectDividerStep(page)
  })

  test('part of a line follows the pointer into the next track and across another line: the gaps count (cr34 W8)', async ({ page }) => {
    // a a b
    // c d d — a|b lies on the second column line, c|d on the first: dragged left, a|b crosses c|d's line.
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['a a b', 'c d d'],
          cells: ['a', 'b', 'c', 'd'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
        },
      }],
    })
    const divider = wsDivider(page, 'a', 'b')
    const d = await box(divider)
    const from = { x: d.x + d.width / 2, y: d.y + d.height / 2 }
    const cdLine = (await edges(wsCell(page, 'c'))).right + 3
    /** How far the a|b line, as drawn, is from the pointer at `x`. */
    const offLine = async (x: number) => {
      const [a, b] = await Promise.all([edges(wsCell(page, 'a')), edges(wsCell(page, 'b'))])
      return Math.abs((a.right + b.left) / 2 - x)
    }
    // Into the middle track, short of c|d's line (and out of its snap's reach): its own two tracks resize.
    const near = { x: cdLine + 120, y: from.y }
    // Then across that line, into the first track: a new line there.
    const far = { x: cdLine - 150, y: from.y }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(near.x, near.y, { steps: 8 })
    await expect.poll(() => offLine(near.x)).toBeLessThanOrEqual(1.5)
    await page.mouse.move(far.x, far.y, { steps: 8 })
    await expect(divider).toHaveAttribute('data-preview', '')
    await expect.poll(() => offLine(far.x)).toBeLessThanOrEqual(1.5)
    // c|d's own line hasn't moved under the preview.
    expect(Math.abs((await edges(wsCell(page, 'c'))).right + 3 - cdLine)).toBeLessThanOrEqual(1)
    await releaseDrag(page)
    await expectDividerStep(page)
    // Released: the line stays where the preview drew it.
    await expect.poll(() => offLine(far.x)).toBeLessThanOrEqual(1.5)
    expect(Math.abs((await edges(wsCell(page, 'c'))).right + 3 - cdLine)).toBeLessThanOrEqual(1)
  })

  test('part of a line made a new line in the track beside it lands under the pointer; the rest of its line stays (cr34 W8)', async ({ page }) => {
    // a | c | x over b | c | y: a|b is one part of the level line, x|y the other.
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['a c x', 'b c y'],
          cells: ['a', 'b', 'c', 'x', 'y'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
        },
      }],
    })
    const divider = wsDivider(page, 'a', 'b')
    const d = await box(divider)
    const from = { x: d.x + d.width / 2, y: d.y + d.height / 2 }
    const xyLine = (await edges(wsCell(page, 'x'))).bottom + 3
    const to = { x: from.x, y: from.y + 100 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await expect(divider).toHaveAttribute('data-preview', '')
    const offLine = async () => {
      const [a, b] = await Promise.all([edges(wsCell(page, 'a')), edges(wsCell(page, 'b'))])
      return Math.abs((a.bottom + b.top) / 2 - to.y)
    }
    await expect.poll(offLine).toBeLessThanOrEqual(1.5)
    // x|y, the rest of the line, is where it was: the new line's gutter came out of the row it split.
    expect(Math.abs((await edges(wsCell(page, 'x'))).bottom + 3 - xyLine)).toBeLessThanOrEqual(1)
    await releaseDrag(page)
    await expectDividerStep(page)
    await expect.poll(offLine).toBeLessThanOrEqual(1.5)
    expect(Math.abs((await edges(wsCell(page, 'x'))).bottom + 3 - xyLine)).toBeLessThanOrEqual(1)
  })

  test('a narrow window: the cells keep 120px and the table scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    const ids = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']
    await seedWorkspace(page, {
      layouts: [{ name: 'Wide', table: { areas: [ids.join(' ')], cells: ids.map((id) => ({ id, tabs: [{ id: `${id}t`, kind: 'notes' as const }] })) } }],
    })
    for (const id of ids) expect(Math.round((await box(wsCell(page, id))).width)).toBeGreaterThanOrEqual(120)
    const table = page.locator('[data-ws-table]')
    const scroll = await table.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(scroll.sw).toBeGreaterThan(scroll.cw)
    expect(await page.locator('[data-ws-area]').evaluate((el) => el.scrollLeft)).toBe(0)
  })
})

test.describe('rows that size themselves', () => {
  test('a row of Numbers fits its content (its divider gives it a height: workspace-crossings); the row under it takes the rest', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['n1 n2', 'a a'],
          cells: [
            { id: 'n1', tabs: [{ id: 'num1', kind: 'number' }] },
            { id: 'n2', tabs: [{ id: 'num2', kind: 'number', glance: { metric: 'overdue' } }] },
            { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
          ],
        },
      }],
    })
    const n = await box(wsCell(page, 'n1'))
    expect(n.height).toBeLessThan(100)
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveAttribute('data-fit', '')
    const area = await areaBox(page)
    expect(Math.round((await edges(wsCell(page, 'a'))).bottom)).toBe(Math.round(area.y + area.height - 6))
  })

  test('Collapse row folds the row a cell lies in; a cell spanning it gets shorter; kept over a reload', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const bBefore = await box(wsCell(page, 'b'))
    const header = wsCell(page, 'a').locator('[data-ws-cell-header]')
    await header.hover()
    await header.getByRole('button', { name: 'Collapse row' }).click()
    await expect(wsCell(page, 'a').locator('[data-ws-cell-body]')).toHaveCount(0)
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a'))).height)).toBe(32)
    // b spans the folded row and the one under it: it keeps its place and size.
    expect(Math.round((await box(wsCell(page, 'b'))).height)).toBe(Math.round(bBefore.height))
    await expect(wsCell(page, 'b').locator('[data-ws-cell-body]')).toBeVisible()
    await expectLayoutStored(page)
    // No divider beside a folded row.
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveCount(0)
    await page.reload()
    await wsCell(page, 'a').getByRole('button', { name: 'Expand row' }).click()
    await expect(wsCell(page, 'a').locator('[data-ws-cell-body]')).toBeVisible()
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveCount(1)
  })
})

test.describe('a collapsed row no filled cell lies only in expands by itself (cr34 M8)', () => {
  const notesCells = (ids: string[]) => ids.map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] }))
  type StoredRows = { grid: { rows: Array<{ collapsed?: boolean }> } }
  const storedCollapse = async (page: Page) => (await readStore<StoredRows>(page, 'layouts'))[0]?.grid.rows.map((r) => r.collapsed === true)

  test('Collapse row, then its cells closed: the row comes back, with its dividers', async ({ page }) => {
    // p  s
    // a  b
    // t1 t2
    await seedWorkspace(page, { layouts: [{ name: 'Main', table: { areas: ['p s', 'a b', 't1 t2'], cells: notesCells(['p', 's', 'a', 'b', 't1', 't2']) } }] })
    await openCellLayoutMenu(page, 'a')
    await page.getByRole('menuitem', { name: 'Collapse row', exact: true }).click()
    await expect.poll(async () => Math.round((await box(wsCell(page, 'a'))).height)).toBe(32)
    await expect.poll(async () => Math.round((await box(wsCell(page, 'b'))).height)).toBe(32)
    // Close t1: a, above it, takes its place and reaches into the last row; b still holds the folded row.
    await openCellLayoutMenu(page, 't1')
    await page.getByRole('menuitem', { name: 'Close cell', exact: true }).click()
    await expect(wsCell(page, 't1')).toHaveCount(0)
    await expect.poll(async () => Math.round((await box(wsCell(page, 'b'))).height)).toBe(32)
    await expect(wsCell(page, 'b').getByRole('button', { name: 'Expand row' })).toBeVisible()
    // Close b: s, above it, takes its place. No cell lies only in the folded row any more: it expands.
    await openCellLayoutMenu(page, 'b')
    await page.getByRole('menuitem', { name: 'Close cell', exact: true }).click()
    await expect(wsCell(page, 'b')).toHaveCount(0)
    // p | a and s | t2: each row line has its divider again (none beside a folded row).
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Expand row' })).toHaveCount(0)
    await expectLayoutStored(page)
    await expect.poll(() => storedCollapse(page)).toEqual([false, false, false])
    // The middle row is a row again: p's and a's line can be dragged.
    const aTop = (await edges(wsCell(page, 'a'))).top
    const d = await box(wsDivider(page, 'p', 'a'))
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2, y: d.y + d.height / 2 + 40 })
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).top - aTop)).toBeGreaterThan(30)
  })

  test('a layout stored with such a row comes right when it is opened, and is stored so', async ({ page }) => {
    // p s
    // a s — the middle row folded, as an earlier build's Collapse row, Close, Close left it
    // a t2
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: { areas: ['p s', 'a s', 'a t2'], rows: [1000, { weight: 1000, collapsed: true }, 1000], cells: notesCells(['p', 's', 'a', 't2']) },
      }],
    })
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveCount(2)
    await expect.poll(() => storedCollapse(page)).toEqual([false, false, false])
    // Three rows of the same weight again: p is a third of the table's height, not most of it.
    const area = await areaBox(page)
    const p = await box(wsCell(page, 'p'))
    expect(Math.abs(p.height - (area.height - 24) / 3)).toBeLessThanOrEqual(2)
    // A folded row a filled cell lies only in is left alone.
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: { areas: ['p s', 'a b', 'a t2'], rows: [1000, { weight: 1000, collapsed: true }, 1000], cells: notesCells(['p', 's', 'a', 'b', 't2']) },
      }],
    })
    await expect(wsCell(page, 'b').getByRole('button', { name: 'Expand row' })).toBeVisible()
    expect(await storedCollapse(page)).toEqual([false, true, false])
  })
})

test.describe('reload and lists', () => {
  test('a drop is saved at once and comes back after a reload', async ({ page }) => {
    await seedWorkspace(page, { layouts: [aBc] })
    const a = await areaBox(page)
    await dragPanel(page, 'c', { x: a.x + 300, y: a.y + 3 })
    await expect.poll(async () => Math.round((await box(cellOf(page, 'notes2'))).width)).toBe(Math.round(a.width - 12))
    await expectLayoutStep(page, 'Moved cell')
    await page.reload()
    await expect.poll(async () => Math.round((await box(cellOf(page, 'notes2'))).width)).toBe(Math.round(a.width - 12))
    await expectLayoutStored(page)
  })

  test('Edit list for a list tab in a fixed row opens on screen', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Team', predicate: { searchText: 'a' } }],
      tasks: [{ title: 'Alpha' }],
      layouts: [{
        name: 'Main',
        table: {
          areas: ['t t', 'a b'],
          rows: [{ px: 300 }, 1000],
          cells: [
            { id: 't', tabs: [{ id: 'bandList', kind: 'lens', listDefIdx: 0 }] },
            { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
            { id: 'b', tabs: [{ id: 'bTab', kind: 'notes' }] },
          ],
        },
      }],
    })
    await expect(wsListWidget(page, 'bandList')).toBeVisible()
    await wsTab(page, 'bandList').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit list…' }).click()
    const popover = page.getByTestId('edit-list')
    await expectInsideViewport(page, popover, 0)
  })
})
