import { expect, test, type Page } from '@playwright/test'
import {
  drag,
  dragTab,
  edges,
  openCellLayoutMenu,
  pickCellMenu,
  pickSplit,
  seedWorkspace,
  wsCell,
  wsDivider,
  wsShape,
  wsTab,
  type WsLayoutSeed,
  wsRow,
  expectLayoutStep,
  expectLayoutStored,
} from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Cells side by side, in a real browser: the ghost of a drop on a body its
 * widget scrolls, the divider between two cells of a row (view state: kept
 * over a reload; the 120px minimum), collapsing a row (its side-by-side
 * cells with it), the cell menu's Split cell ▸ Right / Below and Insert ▸
 * Column, a glance widget alone in its cell (no strip, D26 AA1: its ⋯ on
 * hover and on keyboard focus, its right-click the ⋯ menu), and a phone
 * stacking a row.
 */


/** [colA: (a1: notesTab)] [colB: (b1: calTab)] */
const twoColumns: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
  ],
}

/** [colA: row r1 (c1: notesTab | c2: mapTab), (a2: calTab)] [colB: (b1: notes2)] */
const sideBySide: WsLayoutSeed = {
  name: 'Main',
  columns: [
    {
      id: 'colA',
      rows: [
        { id: 'r1', cells: [{ id: 'c1', tabs: [{ id: 'notesTab', kind: 'notes' }] }, { id: 'c2', tabs: [{ id: 'mapTab', kind: 'neglect' }] }] },
        wsRow({ id: 'a2', tabs: [{ id: 'calTab', kind: 'calendar' }] }),
      ],
    },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'notes2', kind: 'notes' }] })] },
  ],
}

function bodyPoint(page: Page, cellId: string, fx: number, fy: number): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), fx, fy)
}

/** How many rows of the table: the distinct top tracks of its cells. */
async function rowCount(page: Page): Promise<number> {
  return page.evaluate(() => new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-ws-table] [data-ws-cell]'))
    .map((c) => getComputedStyle(c).gridRowStart)).size)
}

test.describe('a body its widget scrolls', () => {
  test('the ghost covers the cell where it is on screen, however far its body is scrolled (cr33 W7)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        columns: [
          // A narrow (≈ 300px) column, the Calendar's row a third of it.
          { id: 'colA', weight: 1, rows: [wsRow({ id: 'kc', tabs: [{ id: 'calTab', kind: 'calendar' }] }, { weight: 3 }), wsRow({ id: 'ka', tabs: [{ id: 'notesA', kind: 'notes' }] }, { weight: 7 })] },
          { id: 'colB', weight: 3, rows: [wsRow({ id: 'b1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
        ],
      }],
    })
    const body = wsCell(page, 'kc').locator('[data-ws-cell-body]')
    // The Calendar's month is taller than this body: the body itself scrolls.
    const scroll = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
    expect(scroll.sh).toBeGreaterThan(scroll.ch + 20)
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(20)
    await dragTab(page, wsTab(page, 'notesTab'), await bodyPoint(page, 'kc', 0.5, 0.5), async () => {
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Add as tab')
      await expect(page.getByTestId('ws-drop-label')).toBeInViewport()
    })
    // b1's place: the two cells on its left cover its edge together, and grow across it.
    await expect.poll(() => wsShape(page)).toEqual([[['calTab', 'notesTab'], ['notesA']]])
  })
})

test.describe('sizes and collapse of cells side by side', () => {
  test('the divider between two cells resizes them, saved at once and kept over a reload', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const c1 = wsCell(page, 'c1')
    const before = (await box(c1)).width
    const d = await box(wsDivider(page, 'c1', 'c2'))
    expect(d.height).toBeGreaterThan(100)
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 - 100, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round(before - (await box(c1)).width)).toBeGreaterThan(80)
    await expectLayoutStored(page)
    // a2 spans both columns under them: it keeps its width.
    const resized = Math.round((await box(c1)).width)
    await expect.poll(async () => {
      const layout = (await readStore<{ grid: { columns: Array<{ weight: number }> } }>(page, 'layouts'))[0]
      const [k1, k2] = layout?.grid.columns ?? []
      return (k1?.weight ?? 1) < (k2?.weight ?? 1)
    }).toBe(true)
    await page.reload()
    await expect.poll(async () => Math.round((await box(c1)).width)).toBe(resized)
  })

  test('the divider stops at the cell minimum width', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const d = await box(wsDivider(page, 'c1', 'c2'))
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: 0, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'c1'))).width)).toBe(120)
  })

  test('collapsing a cell of a row folds the cells beside it too; expanding brings them back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const rowDividers = page.locator('[data-ws-divider][data-axis="rows"]')
    await expect(rowDividers).toHaveCount(1)
    await openCellLayoutMenu(page, 'c1')
    await page.getByRole('menuitem', { name: 'Collapse row' }).click()
    // One widget each: its top line shows, the rest hidden (D26 AA1).
    await expect(wsCell(page, 'c1').locator('[data-ws-cell-body]')).toBeHidden()
    await expect(wsCell(page, 'c2').locator('[data-ws-cell-body]')).toBeHidden()
    await expect(wsCell(page, 'c2').getByRole('button', { name: 'Expand row' })).toBeVisible()
    // b1 spans the folded row: it keeps its body.
    await expect(wsCell(page, 'b1').locator('[data-ws-cell-body]')).toBeVisible()
    await expectLayoutStored(page)
    await expect(rowDividers).toHaveCount(0)
    await page.reload()
    await wsCell(page, 'c2').getByRole('button', { name: 'Expand row' }).click()
    await expect(wsCell(page, 'c1').locator('[data-ws-cell-body]')).toBeVisible()
    await expect(rowDividers).toHaveCount(1)
  })
})

test.describe('the cell menu', () => {
  test('Split cell ▸ Right adds a cell beside, Below one under it; Insert ▸ Column at the right a column', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    const a1 = await edges(wsCell(page, 'a1'))
    await openCellLayoutMenu(page, 'a1')
    await pickSplit(page, 'Right')
    const empty = page.getByRole('region', { name: 'Empty cell' })
    await expect(empty).toBeVisible()
    await expect.poll(async () => (await wsShape(page)).length).toBe(3)
    expect(Math.round((await edges(empty)).top)).toBe(Math.round(a1.top))
    await empty.getByRole('button', { name: 'Close empty cell' }).click()
    await expect.poll(async () => (await wsShape(page)).length).toBe(2)

    await openCellLayoutMenu(page, 'a1')
    await pickSplit(page, 'Below')
    await expect.poll(() => rowCount(page)).toBe(2)
    await page.getByRole('region', { name: 'Empty cell' }).getByRole('button', { name: 'Close empty cell' }).click()
    await expect.poll(() => rowCount(page)).toBe(1)

    await openCellLayoutMenu(page, 'a1')
    await pickCellMenu(page, 'Insert', 'Column at the right')
    await expect.poll(async () => (await wsShape(page)).length).toBe(3)
    await expectLayoutStep(page)
  })
})

test.describe('a glance widget alone in its cell', () => {
  const alone: WsLayoutSeed = {
    name: 'Main',
    columns: [
      { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
      { id: 'colB', rows: [wsRow({ id: 'h1', tabs: [{ id: 'calTab', kind: 'trend' }] })] },
    ],
  }
  /** h1's grip and ⋯ (in its panel header, its top line). */
  const controls = (page: Page) => wsCell(page, 'h1').locator('[data-cell-controls] > span').last()

  test('no strip: its body fills the cell; its grip and ⋯ show on hover', async ({ page }) => {
    await seedWorkspace(page, { layouts: [alone] })
    await page.mouse.move(2, 2)
    await expect(wsCell(page, 'h1').locator('[data-ws-cell-header]')).toHaveCount(0)
    await expect(controls(page)).toHaveCSS('opacity', '0')
    const cell = await box(wsCell(page, 'h1'))
    const body = await box(wsCell(page, 'h1').locator('[data-ws-cell-body]'))
    expect(Math.round(body.y)).toBe(Math.round(cell.y))
    expect(Math.round(body.height)).toBe(Math.round(cell.height))
    await wsCell(page, 'h1').locator('[data-ws-cell-body]').hover()
    await expect(controls(page)).toHaveCSS('opacity', '1')
    await page.mouse.move(2, 2)
    await expect(controls(page)).toHaveCSS('opacity', '0')
  })

  test('keyboard focus inside the cell shows its ⋯', async ({ page }) => {
    await seedWorkspace(page, { layouts: [alone] })
    await page.mouse.move(2, 2)
    // Tab from the cell before it until the focus lands in h1.
    await wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }).focus()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(() => document.activeElement?.closest('[data-ws-cell="h1"]') != null)) break
    }
    expect(await page.evaluate(() => document.activeElement?.closest('[data-ws-cell="h1"]') != null)).toBe(true)
    await expect(controls(page)).toHaveCSS('opacity', '1')
  })

  test('its right-click opens the ⋯ menu, and the ⋯ stays shown while the menu is open', async ({ page }) => {
    await seedWorkspace(page, { layouts: [alone] })
    await wsCell(page, 'h1').locator('[data-ws-cell-body]').click({ button: 'right', position: { x: 200, y: 200 } })
    await expect(page.getByRole('menu', { name: 'Cell options' })).toBeVisible()
    await page.mouse.move(2, 2)
    await expect(controls(page)).toHaveCSS('opacity', '1')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Cell options' })).toHaveCount(0)
    await page.mouse.move(2, 2)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await expect(controls(page)).toHaveCSS('opacity', '0')
  })

  test('a drag measures no strip: the top of its body is the new-row zone', async ({ page }) => {
    await seedWorkspace(page, { layouts: [alone] })
    await dragTab(page, wsTab(page, 'notesTab'), await bodyPoint(page, 'h1', 0.5, 0.06), async () => {
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Split Created vs completed · above')
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab'], ['calTab']]])
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('a row of two cells stacks them, in order', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const c1 = await box(wsCell(page, 'c1'))
    const c2 = await box(wsCell(page, 'c2'))
    const a2 = await box(wsCell(page, 'a2'))
    expect(Math.round(c1.x)).toBe(Math.round(c2.x))
    expect(Math.round(c1.width)).toBe(Math.round(c2.width))
    expect(c2.y).toBeGreaterThan(c1.y + c1.height - 1)
    expect(a2.y).toBeGreaterThan(c2.y + c2.height - 1)
  })

  test('a cell of a row offers Collapse row, which folds the cells beside it too (cr33 W4)', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    await wsCell(page, 'c1').getByRole('button', { name: 'Cell options' }).tap()
    const menu = page.getByRole('menu', { name: 'Cell options' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Collapse row'])
    await menu.getByRole('menuitem', { name: 'Collapse row' }).tap()
    for (const id of ['c1', 'c2']) {
      // One widget each: its top line shows, the rest hidden (D26 AA1).
      await expect(wsCell(page, id).locator('[data-ws-cell-body]')).toBeHidden()
      await expect(wsCell(page, id).getByRole('button', { name: 'Expand row' })).toBeVisible()
    }
    await expect(wsCell(page, 'a2').locator('[data-ws-cell-body]')).toBeVisible()
  })
})
