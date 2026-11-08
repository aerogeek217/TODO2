import { expect, test, type Page } from '@playwright/test'
import {
  drag,
  dragPanel,
  dragTab,
  pickSplit,
  seedWorkspace,
  wsBand,
  wsCell,
  wsShape,
  wsTab,
  type WsLayoutSeed,
  wsRow,
} from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Rows of cells side by side, in a real browser: a cell's left / right drop
 * zones (a new cell beside it, the vertical bar while dragging), a
 * multi-cell row's top zone (a new row above the whole row), the divider
 * between two cells (view state: kept over a reload), a band's second cell
 * and its divider, collapsing a whole row, the cell menu's Split ▸ Right /
 * Below / New column, a headless cell (its strip on hover, on keyboard
 * focus, its right-click the tab menu), and a phone stacking a row.
 */

const saveButton = (page: Page) => page.getByTestId('layout-save')
const UNSAVED = 'Save layout (unsaved changes)'
const SAVED = 'Layout saved'

/** [colA: (a1: notesTab)] [colB: (b1: calTab)] */
const twoColumns: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
  ],
}

/** [colA: row r1 (c1: notesTab | c2: eisTab), (a2: calTab)] [colB: (b1: notes2)] */
const sideBySide: WsLayoutSeed = {
  name: 'Main',
  columns: [
    {
      id: 'colA',
      rows: [
        { id: 'r1', cells: [{ id: 'c1', tabs: [{ id: 'notesTab', kind: 'notes' }] }, { id: 'c2', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] },
        wsRow({ id: 'a2', tabs: [{ id: 'calTab', kind: 'calendar' }] }),
      ],
    },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'notes2', kind: 'notes' }] })] },
  ],
}

function bodyPoint(page: Page, cellId: string, fx: number, fy: number): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), fx, fy)
}

/** Cell ids per row per column, read from the rendered workspace. */
async function rowShape(page: Page): Promise<string[][][]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ws-column]')).map((col) =>
      Array.from(col.querySelectorAll('[data-ws-row]')).map((row) =>
        Array.from(row.querySelectorAll<HTMLElement>('[data-ws-cell]')).map((c) => c.dataset.wsCell ?? ''),
      ),
    ),
  )
}

test.describe('drops beside a cell', () => {
  // D26 P2: the drop zones and bars are the table hit test and ghost.
  test.fixme('a tab on a cell’s right edge makes a two-cell row (a vertical bar while dragging)', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await dragTab(page, wsTab(page, 'calTab'), await bodyPoint(page, 'a1', 0.95, 0.5), async () => {
      await expect(wsCell(page, 'a1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'right')
      await expect(page.getByTestId('ws-new-cell-bar')).toHaveAttribute('data-axis', 'vertical')
      const bar = await box(page.getByTestId('ws-new-cell-bar'))
      const cell = await box(wsCell(page, 'a1'))
      expect(bar.height).toBeCloseTo(cell.height, 0)
      expect(bar.x).toBeGreaterThan(cell.x + cell.width - 1)
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab'], ['calTab']]])
    const shape = await rowShape(page)
    expect(shape[0]).toHaveLength(1)
    expect(shape[0]?.[0]?.[0]).toBe('a1')
    expect(shape[0]?.[0]).toHaveLength(2)
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
  })

  // D26 P2: the drop zones and bars are the table hit test and ghost.
  test.fixme('a tab on a cell’s left edge goes before it; the middle still joins', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await dragTab(page, wsTab(page, 'calTab'), await bodyPoint(page, 'a1', 0.05, 0.5), async () => {
      await expect(wsCell(page, 'a1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'left')
    })
    await expect.poll(() => wsShape(page)).toEqual([[['calTab'], ['notesTab']]])
    expect((await rowShape(page))[0]?.[0]?.at(-1)).toBe('a1')
  })

  // D26 P2: the drop zones and bars are the table hit test and ghost.
  test.fixme('a multi-cell row’s top zone makes a new row above the whole row; a panel drag moves a cell beside another', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    await dragTab(page, wsTab(page, 'notes2'), await bodyPoint(page, 'c2', 0.5, 0.1), async () => {
      await expect(wsCell(page, 'c2').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'top')
      await expect(wsCell(page, 'c2').getByTestId('ws-drop-zones')).toContainText('New row above')
      const bar = await box(page.getByTestId('ws-new-cell-bar'))
      const row = await box(page.locator('[data-ws-row="r1"]'))
      expect(bar.width).toBeCloseTo(row.width, 0)
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notes2'], ['notesTab'], ['eisTab'], ['calTab']]])
    const shape = await rowShape(page)
    expect(shape[0]?.map((r) => r.length)).toEqual([1, 2, 1])

    // The calendar cell, dragged by its header, beside the Eisenhower in r1.
    await dragPanel(page, 'a2', await bodyPoint(page, 'c2', 0.97, 0.5), {
      during: async () => {
        await expect(wsCell(page, 'c2').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'right')
      },
    })
    // The moved cell is a new one (its tabs and config kept), third in r1; the row it left goes.
    await expect.poll(async () => (await rowShape(page))[0]?.map((r) => r.length)).toEqual([1, 3])
    expect((await rowShape(page))[0]?.[1]?.slice(0, 2)).toEqual(['c1', 'c2'])
    expect(await wsShape(page)).toEqual([[['notes2'], ['notesTab'], ['eisTab'], ['calTab']]])
  })
})

test.describe('a body its widget scrolls', () => {
  // D26 P2: the drop zones are the table hit test and ghost.
  test.fixme('the drop zones cover the body where it is on screen, however far it is scrolled (cr33 W7)', async ({ page }) => {
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
      const zones = wsCell(page, 'kc').getByTestId('ws-drop-zones')
      await expect(zones).toHaveAttribute('data-active-zone', 'middle')
      const z = await box(zones)
      const b = await box(body)
      expect(Math.abs(z.y - b.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(z.height - b.height)).toBeLessThanOrEqual(1)
      await expect(zones.getByText('Add as tab')).toBeInViewport()
    })
    await expect.poll(() => wsShape(page)).toEqual([[['calTab', 'notesTab'], ['notesA']]])
  })
})

test.describe('sizes and collapse of a row of cells', () => {
  // D26 P2: the dividers are per edge stretch now (none drawn until P2).
  test.fixme('the divider between two cells resizes them, saved at once and kept over a reload', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const c1 = wsCell(page, 'c1')
    const before = (await box(c1)).width
    const d = await box(page.locator('[data-ws-divider="c1|c2"]'))
    expect(d.height).toBeGreaterThan(100)
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 - 100, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round(before - (await box(c1)).width)).toBeGreaterThan(80)
    await expect(saveButton(page)).toHaveAccessibleName(SAVED)
    const resized = Math.round((await box(c1)).width)
    await expect.poll(async () => {
      const layout = (await readStore<{ columns: Array<{ rows: Array<{ cells: Array<{ id: string; weight: number }> }> }> }>(page, 'layouts'))[0]
      const cells = layout?.columns[0]?.rows[0]?.cells ?? []
      return (cells[0]?.weight ?? 1) < (cells[1]?.weight ?? 1)
    }).toBe(true)
    await page.reload()
    await expect.poll(async () => Math.round((await box(c1)).width)).toBe(resized)
  })

  // D26 P2: the dividers are per edge stretch now (none drawn until P2).
  test.fixme('the divider stops at the cell minimum width', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const d = await box(page.locator('[data-ws-divider="c1|c2"]'))
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: 0, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'c1'))).width)).toBe(120)
  })

  // D26 P2: collapse is a row track’s now; rewrite for the table.
  test.fixme('collapsing a cell of a multi-cell row folds the whole row; expanding brings it back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    const header = wsCell(page, 'c1').locator('[data-ws-cell-header]')
    await header.hover()
    await header.getByRole('button', { name: 'Collapse row' }).click()
    await expect(wsCell(page, 'c1').locator('[data-ws-cell-body]')).toHaveCount(0)
    await expect(wsCell(page, 'c2').locator('[data-ws-cell-body]')).toHaveCount(0)
    await expect(wsCell(page, 'c2').getByRole('button', { name: 'Expand row' })).toBeVisible()
    await expect(saveButton(page)).toHaveAccessibleName(SAVED)
    // The row below takes the room; the row divider is gone above the collapsed row.
    await expect(page.getByRole('separator', { name: 'Resize rows' })).toHaveCount(0)
    await page.reload()
    await wsCell(page, 'c2').getByRole('button', { name: 'Expand row' }).click()
    await expect(wsCell(page, 'c1').locator('[data-ws-cell-body]')).toBeVisible()
    await expect(page.getByRole('separator', { name: 'Resize rows' })).toHaveCount(1)
  })
})

test.describe('bands of several cells', () => {
  const withBand: WsLayoutSeed = {
    ...twoColumns,
    top: { id: 'tb-band', height: 200, cells: [{ id: 'tb', tabs: [{ id: 'topNotes', kind: 'notes' }] }] },
  }

  // D26 P2: bands are fixed rows of the table.
  test.fixme('a band takes a second cell on its right edge, and its divider resizes the two', async ({ page }) => {
    await seedWorkspace(page, { layouts: [withBand] })
    const band = wsBand(page, 'top')
    await dragTab(page, wsTab(page, 'calTab'), await pointIn(band.locator('[data-ws-cell-body]'), 0.97, 0.5), async () => {
      await expect(band.getByTestId('ws-band-drop-zone')).toHaveAttribute('data-active-zone', 'right')
      await expect(page.getByTestId('ws-new-cell-bar')).toHaveAttribute('data-axis', 'vertical')
    })
    await expect(band.locator('[data-ws-cell]')).toHaveCount(2)
    await expect(band.locator('[data-ws-cell]').nth(1).locator('[data-ws-tab="calTab"]')).toBeVisible()
    const first = band.locator('[data-ws-cell="tb"]')
    const before = (await box(first)).width
    const d = await box(band.locator('[data-ws-divider]'))
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2 + 150, y: d.y + d.height / 2 })
    await expect.poll(async () => Math.round((await box(first)).width - before)).toBeGreaterThan(120)
    // The band's middle still joins its cell.
    await dragTab(page, wsTab(page, 'notesTab'), await pointIn(first.locator('[data-ws-cell-body]'), 0.5, 0.5), async () => {
      await expect(band.getByTestId('ws-band-drop-zone').first()).toHaveAttribute('data-active-zone', 'middle')
    })
    await expect(first.locator('[data-ws-tab]')).toHaveCount(2)
  })
})

test.describe('the cell menu', () => {
  async function openCellMenu(page: Page, cellId: string): Promise<void> {
    const header = wsCell(page, cellId).locator('[data-ws-cell-header]')
    // Over the cell first: a headless cell's strip slides in on hover.
    await wsCell(page, cellId).hover()
    await header.getByRole('button', { name: 'Cell options' }).click()
  }

  // D26 P2: the cell menu’s table words (Split / Insert / Merge).
  test.fixme('Split ▸ Right adds a cell beside, Below a row under it, New column a column', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await openCellMenu(page, 'a1')
    await pickSplit(page, 'Right')
    await expect.poll(async () => (await rowShape(page))[0]?.[0]?.length).toBe(2)
    await expect(page.getByRole('region', { name: 'Empty cell' })).toBeVisible()
    await page.getByRole('region', { name: 'Empty cell' }).getByRole('button', { name: 'Close empty cell' }).click()

    await openCellMenu(page, 'a1')
    await pickSplit(page, 'Below')
    await expect.poll(async () => (await rowShape(page))[0]?.length).toBe(2)
    await page.getByRole('region', { name: 'Empty cell' }).getByRole('button', { name: 'Close empty cell' }).click()

    await openCellMenu(page, 'a1')
    await pickSplit(page, 'New column')
    await expect.poll(async () => (await rowShape(page)).length).toBe(3)
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
  })

  // D26 P2: Show / Hide tab strip went with stripShown (P3: tabs on demand).
  test.fixme('Hide tab strip makes a one-tab cell headless; Show tab strip brings it back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoColumns] })
    await openCellMenu(page, 'a1')
    await page.getByRole('menuitem', { name: 'Hide tab strip' }).click()
    await expect(wsCell(page, 'a1')).toHaveAttribute('data-headless', 'true')
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
    await openCellMenu(page, 'a1')
    await page.getByRole('menuitem', { name: 'Show tab strip' }).click()
    await expect(wsCell(page, 'a1')).not.toHaveAttribute('data-headless', 'true')
  })
})

test.describe('a headless cell', () => {
  const headless: WsLayoutSeed = {
    name: 'Main',
    columns: [
      { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }] })] },
      { id: 'colB', rows: [wsRow({ id: 'h1', tabs: [{ id: 'calTab', kind: 'trend' }] })] },
    ],
  }
  const strip = (page: Page) => wsCell(page, 'h1').locator('[data-ws-cell-header]')

  test('its strip is hidden, slides in on hover, and its body fills the cell', async ({ page }) => {
    await seedWorkspace(page, { layouts: [headless] })
    await page.mouse.move(2, 2)
    await expect(strip(page)).toHaveCSS('opacity', '0')
    const cell = await box(wsCell(page, 'h1'))
    const body = await box(wsCell(page, 'h1').locator('[data-ws-cell-body]'))
    expect(Math.round(body.y)).toBe(Math.round(cell.y))
    await wsCell(page, 'h1').locator('[data-ws-cell-body]').hover()
    await expect(strip(page)).toHaveCSS('opacity', '1')
    const s = await box(strip(page))
    expect(Math.round(s.y)).toBe(Math.round(cell.y))
    expect(Math.round(s.height)).toBe(24)
    await page.mouse.move(2, 2)
    await expect(strip(page)).toHaveCSS('opacity', '0')
  })

  test('keyboard focus inside the cell shows its strip', async ({ page }) => {
    await seedWorkspace(page, { layouts: [headless] })
    await page.mouse.move(2, 2)
    // Tab from the cell before it until the focus lands in the headless cell.
    await wsTab(page, 'notesTab').focus()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      if (await page.evaluate(() => document.activeElement?.closest('[data-ws-cell="h1"]') != null)) break
    }
    expect(await page.evaluate(() => document.activeElement?.closest('[data-ws-cell="h1"]') != null)).toBe(true)
    await expect(strip(page)).toHaveCSS('opacity', '1')
  })

  test('its right-click opens the tab menu, and the strip stays in while the menu is open', async ({ page }) => {
    await seedWorkspace(page, { layouts: [headless] })
    await wsCell(page, 'h1').locator('[data-ws-cell-body]').click({ button: 'right', position: { x: 200, y: 200 } })
    await expect(page.getByRole('menu', { name: 'Change widget' })).toBeVisible()
    await page.mouse.move(2, 2)
    await expect(strip(page)).toHaveCSS('opacity', '1')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: 'Change widget' })).toHaveCount(0)
    await expect(strip(page)).toHaveCSS('opacity', '0')
  })

  test('a drag measures no strip: the top of its body is the new-row zone', async ({ page }) => {
    await seedWorkspace(page, { layouts: [headless] })
    await dragTab(page, wsTab(page, 'notesTab'), await bodyPoint(page, 'h1', 0.5, 0.06), async () => {
      await expect(wsCell(page, 'h1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'top')
      await expect(strip(page)).toHaveCSS('opacity', '0')
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

  // D26 P2: the phone shows every cell in one scroll.
  test.fixme('a cell of a multi-cell row offers Collapse row, which folds the whole row (cr33 W4)', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sideBySide] })
    await wsCell(page, 'c1').getByRole('button', { name: 'Cell options' }).tap()
    const menu = page.getByRole('menu', { name: 'Cell options' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Collapse row'])
    await menu.getByRole('menuitem', { name: 'Collapse row' }).tap()
    for (const id of ['c1', 'c2']) {
      await expect(wsCell(page, id).locator('[data-ws-cell-body]')).toHaveCount(0)
      await expect(wsCell(page, id).getByRole('button', { name: 'Expand row' })).toBeVisible()
    }
    // A one-cell row's cell still says cell.
    await wsCell(page, 'a2').getByRole('button', { name: 'Cell options' }).tap()
    await expect(page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem')).toHaveText(['Collapse cell'])
  })
})
