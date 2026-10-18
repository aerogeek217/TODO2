import { expect, test, type Page } from '@playwright/test'
import {
  dragPanel,
  dragTab,
  releaseDrag,
  seedWorkspace,
  wsBand,
  wsBandTabs,
  wsCell,
  wsListWidget,
  wsPanelHandle,
  wsShape,
  wsTab,
  type WsLayoutSeed,
} from './fixtures/workspace'
import { box, expectInsideViewport, pointIn, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Full-width bands (one above and one below the columns) and whole-panel
 * drags, in a real browser: every drop target for a tab drag and for a
 * panel drag (new band, into a band, band strip, column edge, cell edge,
 * merge on a panel's middle, tab strip, no-ops), the header handle (grip on
 * hover without moving anything, the 5px threshold), band height resize and
 * collapse, the band and panel ⋯ menus, narrow windows (bands stay put while
 * the columns scroll), unsaved band changes surviving a reload, and the
 * column area of a layout with only bands.
 */

const saveButton = (page: Page) => page.getByTestId('layout-save')
const UNSAVED = 'Save layout (unsaved changes)'
const SAVED = 'Layout saved'

/** [colA: (a1: notesTab eisTab)] [colB: (b1: calTab) (b2: dashTab)] */
const threeCells: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'eisTab', kind: 'eisenhower' }] }] },
    { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] }, { id: 'b2', tabs: [{ id: 'dashTab', kind: 'dashboard' }] }] },
  ],
}

const withTopBand: WsLayoutSeed = {
  ...threeCells,
  top: { id: 'tb', height: 160, tabs: [{ id: 'topNotes', kind: 'notes' }] },
}

async function areaBox(page: Page) {
  return box(page.locator('[data-ws-area]'))
}

/** A point in the top new-band zone above the panels: the workspace's 6px top padding, `x` px in. */
async function topBandZone(page: Page, x = 300): Promise<Point> {
  const a = await areaBox(page)
  return { x: a.x + x, y: a.y + 3 }
}

function bodyPoint(page: Page, cellId: string, fy: number): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), 0.5, fy)
}

test.describe('tab drags and bands', () => {
  test('a tab dragged just above the panels makes a new top band', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const a = await areaBox(page)
    await dragTab(page, wsTab(page, 'eisTab'), await topBandZone(page), async () => {
      await expect(page.getByTestId('ws-new-band-strip')).toHaveAttribute('data-edge', 'top')
      await expect(page.getByTestId('ws-drop-label')).toHaveText('New band above all columns')
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['eisTab'])
    await expect(wsTab(page, 'eisTab')).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab'], ['dashTab']]])
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
    // Full width, above the columns, 160px.
    const band = await box(wsBand(page, 'top'))
    const col = await box(page.locator('[data-ws-column="colA"]'))
    expect(Math.round(band.height)).toBe(160)
    expect(band.y + band.height).toBeLessThan(col.y)
    expect(Math.round(band.width)).toBe(Math.round(a.width - 12))
  })

  test('the zone reaches a little over the top bar’s lower edge', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const a = await areaBox(page)
    await dragTab(page, wsTab(page, 'eisTab'), { x: a.x + 300, y: a.y - 8 }, async () => {
      await expect(page.getByTestId('ws-new-band-strip')).toHaveAttribute('data-edge', 'top')
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['eisTab'])
  })

  test('a tab strip wins over the band edge: a drop on the top part of a top-row strip inserts, no band', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const header = await box(wsCell(page, 'b1').locator('[data-ws-cell-header]'))
    const cal = await box(wsTab(page, 'calTab'))
    await dragTab(page, wsTab(page, 'eisTab'), { x: cal.x + 10, y: header.y + 3 }, async () => {
      await expect(wsCell(page, 'b1').getByTestId('ws-tab-insert-line')).toBeVisible()
      await expect(page.getByTestId('ws-new-band-strip')).toHaveCount(0)
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['eisTab', 'calTab'], ['dashTab']]])
    await expect(wsBand(page, 'top')).toHaveCount(0)
  })

  test('the bottom 24px make a new bottom band; idle edge bars show where no band is', async ({ page }) => {
    await seedWorkspace(page, { layouts: [withTopBand] })
    const a = await areaBox(page)
    await dragTab(page, wsTab(page, 'calTab'), { x: a.x + 300, y: a.y + a.height - 6 }, async () => {
      await expect(page.getByTestId('ws-new-band-strip')).toHaveAttribute('data-edge', 'bottom')
      await expect(page.getByTestId('ws-drop-label')).toHaveText('New band below all columns')
    })
    await expect.poll(() => wsBandTabs(page, 'bottom')).toEqual(['calTab'])

    // With both bands there: no band-edge bars; with one, its free edge only.
    const handle = wsTab(page, 'notesTab')
    const p = await pointIn(handle)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 30, { steps: 3 })
    await expect(page.getByTestId('ws-band-edge-bar')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await releaseDrag(page)
  })

  test('a tab dropped on a band body joins it (one zone, ghost tab); on its strip at the line; out again the band goes', async ({ page }) => {
    await seedWorkspace(page, { layouts: [withTopBand] })
    const body = await pointIn(wsBand(page, 'top').locator('[data-ws-cell-body]'), 0.5, 0.6)
    await dragTab(page, wsTab(page, 'eisTab'), body, async () => {
      await expect(wsBand(page, 'top').getByTestId('ws-band-drop-zone')).toHaveAttribute('data-active', 'true')
      await expect(wsBand(page, 'top').getByTestId('ws-band-drop-zone')).toContainText('Add as tab')
      await expect(wsBand(page, 'top').getByTestId('ws-ghost-tab')).toHaveCount(1)
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['topNotes', 'eisTab'])

    // The strip: before the first tab.
    const first = await box(wsTab(page, 'topNotes'))
    await dragTab(page, wsTab(page, 'calTab'), { x: first.x + 12, y: first.y + first.height / 2 }, async () => {
      await expect(wsBand(page, 'top').getByTestId('ws-tab-insert-line')).toBeVisible()
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['calTab', 'topNotes', 'eisTab'])

    // Every tab out: the band goes and the columns take the height.
    for (const id of ['calTab', 'topNotes', 'eisTab']) {
      await dragTab(page, wsTab(page, id), await bodyPoint(page, 'b2', 0.5))
    }
    await expect(wsBand(page, 'top')).toHaveCount(0)
    const a = await areaBox(page)
    const col = await box(page.locator('[data-ws-column="colA"]'))
    expect(Math.round(col.y)).toBe(Math.round(a.y + 6))
  })

  test('column-edge zones span the column area only, not the band', async ({ page }) => {
    await seedWorkspace(page, { layouts: [withTopBand] })
    const a = await box(page.locator('[data-ws-column="colA"]'))
    const b = await box(page.locator('[data-ws-column="colB"]'))
    const gutterX = (a.x + a.width + b.x) / 2
    const bandBody = await box(wsBand(page, 'top').locator('[data-ws-cell-body]'))
    await dragTab(page, wsTab(page, 'eisTab'), { x: gutterX, y: bandBody.y + bandBody.height / 2 }, async () => {
      await expect(page.getByTestId('ws-new-column-band')).toHaveCount(0)
      await expect(wsBand(page, 'top').getByTestId('ws-band-drop-zone')).toHaveAttribute('data-active', 'true')
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['topNotes', 'eisTab'])

    await dragTab(page, wsTab(page, 'eisTab'), { x: gutterX, y: a.y + a.height / 2 }, async () => {
      const zone = await box(page.getByTestId('ws-new-column-band'))
      expect(Math.round(zone.y)).toBe(Math.round(a.y))
      expect(zone.y + zone.height).toBeLessThanOrEqual(a.y + a.height + 1)
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['eisTab']], [['calTab'], ['dashTab']]])
  })
})

test.describe('panel drags', () => {
  test('the grip shows on header hover without moving anything; a click on the empty space moves nothing', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const handle = wsPanelHandle(page, 'a1')
    const grip = handle.locator('span')
    const before = await box(wsTab(page, 'eisTab'))
    const actionsBefore = await box(wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }))
    await expect(grip).toHaveCSS('opacity', '0')
    await handle.hover()
    await expect(grip).toHaveCSS('opacity', '0.9')
    await expect(handle).toHaveCSS('cursor', 'grab')
    expect(await box(wsTab(page, 'eisTab'))).toEqual(before)
    expect(await box(wsCell(page, 'a1').getByRole('button', { name: 'Cell options' }))).toEqual(actionsBefore)

    // Pressed: accent grip; a click without movement does nothing.
    const p = await pointIn(handle)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 3, p.y, { steps: 2 })
    await expect(page.getByTestId('ws-panel-ghost')).toHaveCount(0)
    await page.mouse.up()
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab'], ['dashTab']]])
    await expect(saveButton(page)).toHaveAccessibleName(SAVED)
  })

  test('panel → new column: the source dims, the ghost shows its tabs and count', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const a = await box(page.locator('[data-ws-column="colA"]'))
    const b = await box(page.locator('[data-ws-column="colB"]'))
    await dragPanel(page, 'b1', { x: (a.x + a.width + b.x) / 2, y: a.y + a.height / 2 }, {
      lifted: async () => {
        await expect(wsCell(page, 'b1')).toHaveCSS('opacity', '0.4')
        await expect(page.getByTestId('ws-panel-ghost')).toContainText('1 tab')
      },
      during: async () => {
        await expect(page.getByTestId('ws-new-column-band')).toBeVisible()
        await expect(page.getByTestId('ws-drop-label')).toHaveText('New column')
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']], [['dashTab']]])
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
  })

  test('panel → another panel’s middle merges all its tabs, the first moved one active', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    await dragPanel(page, 'a1', await bodyPoint(page, 'b2', 0.5), {
      lifted: async () => {
        await expect(page.getByTestId('ws-panel-ghost')).toContainText('2 tabs')
        await expect(page.getByTestId('ws-panel-ghost')).toContainText('Notes')
        await expect(page.getByTestId('ws-panel-ghost')).toContainText('Eisenhower')
      },
      during: async () => {
        await expect(wsCell(page, 'b2').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'middle')
        await expect(wsCell(page, 'b2').getByTestId('ws-drop-zones')).toContainText('Merge 2 tabs here')
        await expect(wsCell(page, 'b2').getByTestId('ws-ghost-tab')).toHaveCount(2)
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['calTab'], ['dashTab', 'notesTab', 'eisTab']]])
    await expect(wsTab(page, 'notesTab')).toHaveAttribute('aria-selected', 'true')
  })

  test('panel → a cell edge makes a new cell with all its tabs', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    await dragPanel(page, 'a1', await bodyPoint(page, 'b1', 0.9), {
      during: async () => {
        await expect(wsCell(page, 'b1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', 'bottom')
        await expect(page.getByTestId('ws-new-cell-bar')).toBeVisible()
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['calTab'], ['notesTab', 'eisTab'], ['dashTab']]])
  })

  test('panel → a tab strip inserts all its tabs at the line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    // The top part of a top-row strip: the strip wins over the band edge.
    const header = await box(wsCell(page, 'b1').locator('[data-ws-cell-header]'))
    const cal = await box(wsTab(page, 'calTab'))
    await dragPanel(page, 'a1', { x: cal.x + 10, y: header.y + 3 }, {
      during: async () => {
        await expect(wsCell(page, 'b1').getByTestId('ws-tab-insert-line')).toBeVisible()
        await expect(page.getByTestId('ws-drop-label')).toHaveText('Insert 2 tabs')
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab', 'calTab'], ['dashTab']]])
    await expect(wsBand(page, 'top')).toHaveCount(0)
  })

  test('panel → new top band from the zone above the panels', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    await dragPanel(page, 'b1', await topBandZone(page, 600), {
      during: async () => {
        await expect(page.getByTestId('ws-new-band-strip')).toHaveAttribute('data-edge', 'top')
        await expect(page.getByTestId('ws-drop-label')).toHaveText('New band above all columns')
      },
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['calTab'])
  })

  test('panel → new bottom band; near the window’s bottom the ghost flips above the pointer', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const a = await areaBox(page)
    const to = { x: a.x + 300, y: a.y + a.height - 6 }
    await dragPanel(page, 'a1', to, {
      during: async () => {
        await expect(page.getByTestId('ws-new-band-strip')).toHaveAttribute('data-edge', 'bottom')
        await expect(page.getByTestId('ws-drop-label')).toHaveText('New band below all columns')
        const ghost = await box(page.getByTestId('ws-panel-ghost'))
        expect(ghost.y + ghost.height).toBeLessThanOrEqual(to.y)
        await expectInsideViewport(page, page.getByTestId('ws-panel-ghost'), 0)
      },
    })
    await expect.poll(() => wsBandTabs(page, 'bottom')).toEqual(['notesTab', 'eisTab'])
    await expect.poll(() => wsShape(page)).toEqual([[['calTab'], ['dashTab']]])
  })

  test('over its own panel nothing lights up and nothing changes; Escape cancels a panel drag', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    await dragPanel(page, 'b1', await bodyPoint(page, 'b1', 0.5), {
      during: async () => {
        await expect(wsCell(page, 'b1').getByTestId('ws-drop-zones')).toHaveAttribute('data-active-zone', '')
      },
    })
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab'], ['dashTab']]])
    await expect(saveButton(page)).toHaveAccessibleName(SAVED)

    const p = await pointIn(wsPanelHandle(page, 'a1'))
    const to = await bodyPoint(page, 'b2', 0.5)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x, p.y + 20, { steps: 2 })
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.keyboard.press('Escape')
    await releaseDrag(page)
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab'], ['dashTab']]])
    await expect(wsCell(page, 'a1')).toHaveCSS('opacity', '1')
  })

  test('a band dragged by its header: into a cell, then a panel into the band', async ({ page }) => {
    await seedWorkspace(page, { layouts: [{ ...withTopBand, top: { id: 'tb', height: 160, tabs: [{ id: 'topNotes', kind: 'notes' }, { id: 'topEis', kind: 'eisenhower' }] } }] })
    // A panel into the band's body: merge.
    const bandBody = await pointIn(wsBand(page, 'top').locator('[data-ws-cell-body]'), 0.5, 0.6)
    await dragPanel(page, 'b1', bandBody, {
      during: async () => {
        await expect(wsBand(page, 'top').getByTestId('ws-band-drop-zone')).toContainText('Merge 1 tab here')
      },
    })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['topNotes', 'topEis', 'calTab'])
    // The band's header onto a column edge: a new column; the band goes.
    const a = await areaBox(page)
    await dragPanel(page, 'tb', { x: a.x + a.width - 8, y: a.y + a.height / 2 })
    await expect(wsBand(page, 'top')).toHaveCount(0)
    // (The narrow new column shows its active tab in the last visible place: compare the set.)
    await expect.poll(async () => (await wsShape(page)).map((col) => col.map((cell) => [...cell].sort()))).toEqual([[['eisTab', 'notesTab']], [['dashTab']], [['calTab', 'topEis', 'topNotes']]])
  })
})

test.describe('band height, collapse and menus', () => {
  test('the band divider resizes the band (unsaved); past the minimum it collapses; double-click = 160; arrows step 16px', async ({ page }) => {
    await seedWorkspace(page, { layouts: [withTopBand] })
    const divider = page.getByRole('separator', { name: 'Resize top band' })
    const d = await box(divider)
    await page.mouse.move(d.x + 300, d.y + d.height / 2)
    await page.mouse.down()
    await page.mouse.move(d.x + 300, d.y + d.height / 2 + 80, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await box(wsBand(page, 'top'))).height)).toBe(240)
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
    await saveButton(page).click()
    await expect(saveButton(page)).toHaveAccessibleName(SAVED)
    expect((await readStore(page, 'layouts'))[0]).toMatchObject({ top: { height: 240 } })

    await divider.dblclick()
    await expect.poll(async () => Math.round((await box(wsBand(page, 'top'))).height)).toBe(160)
    await divider.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round((await box(wsBand(page, 'top'))).height)).toBe(176)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => Math.round((await box(wsBand(page, 'top'))).height)).toBe(144)

    // Far up: the band collapses to its header (view state: no unsaved change from the collapse).
    await saveButton(page).click()
    const d2 = await box(divider)
    await page.mouse.move(d2.x + 300, d2.y + 3)
    await page.mouse.down()
    await page.mouse.move(d2.x + 300, d2.y - 200, { steps: 10 })
    await page.mouse.up()
    await expect(wsBand(page, 'top').getByRole('button', { name: 'Expand band' })).toBeVisible()
    await expect(divider).toHaveCount(0)
    expect(Math.round((await box(wsBand(page, 'top'))).height)).toBe(32)
    await expect(saveButton(page)).toHaveAccessibleName(SAVED)
    await page.reload()
    await expect(wsBand(page, 'top').getByRole('button', { name: 'Expand band' })).toBeVisible()
    // A click on a flat tab expands it.
    await wsTab(page, 'topNotes').click()
    await expect.poll(async () => Math.round((await box(wsBand(page, 'top'))).height)).toBe(144)
  })

  test('the band ⋯ menu moves the band to the other edge, out as a column, and closes it', async ({ page }) => {
    await seedWorkspace(page, { layouts: [withTopBand] })
    const header = wsBand(page, 'top').locator('[data-ws-cell-header]')
    await header.hover()
    await header.getByRole('button', { name: 'Band options' }).click()
    await expect(page.getByRole('menuitem', { name: 'Split right' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Move to bottom band' }).click()
    await expect(wsBand(page, 'top')).toHaveCount(0)
    await expect.poll(() => wsBandTabs(page, 'bottom')).toEqual(['topNotes'])

    const bottomHeader = wsBand(page, 'bottom').locator('[data-ws-cell-header]')
    await bottomHeader.hover()
    await bottomHeader.getByRole('button', { name: 'Band options' }).click()
    await page.getByRole('menuitem', { name: 'Move to a new column' }).click()
    await expect(wsBand(page, 'bottom')).toHaveCount(0)
    await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab'], ['dashTab']], [['topNotes']]])

    // The panel menu: Move to top band, then Move into top band; Close band.
    const cellHeader = wsCell(page, 'b2').locator('[data-ws-cell-header]')
    await cellHeader.hover()
    await cellHeader.getByRole('button', { name: 'Cell options' }).click()
    await page.getByRole('menuitem', { name: 'Move to top band' }).click()
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['dashTab'])
    const aHeader = wsCell(page, 'a1').locator('[data-ws-cell-header]')
    await aHeader.hover()
    await aHeader.getByRole('button', { name: 'Cell options' }).click()
    await page.getByRole('menuitem', { name: 'Move into top band' }).click()
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['dashTab', 'notesTab', 'eisTab'])
    const topHeader = wsBand(page, 'top').locator('[data-ws-cell-header]')
    await topHeader.hover()
    await topHeader.getByRole('button', { name: 'Band options' }).click()
    await page.getByRole('menuitem', { name: 'Close band (3 tabs)' }).click()
    await expect(wsBand(page, 'top')).toHaveCount(0)
  })

  test('only bands, no columns: the column area offers widgets and takes a dropped tab as the first column', async ({ page }) => {
    await seedWorkspace(page, { layouts: [{ name: 'Bands', columns: [], top: { id: 'tb', tabs: [{ id: 't1', kind: 'notes' }, { id: 't2', kind: 'eisenhower' }] } }] })
    const empty = page.getByRole('region', { name: 'No columns' })
    await expect(empty).toBeVisible()
    await dragTab(page, wsTab(page, 't2'), await pointIn(empty), async () => {
      await expect(empty).toHaveClass(/emptyCellOver/)
    })
    await expect.poll(() => wsShape(page)).toEqual([[['t2']]])
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['t1'])
  })
})

test.describe('narrow windows, reload, phone', () => {
  test('1100px: the columns scroll sideways under bands that stay put', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    await seedWorkspace(page, {
      layouts: [{
        name: 'Wide',
        top: { id: 'tb', tabs: [{ id: 'topNotes', kind: 'notes' }] },
        bottom: { id: 'bb', height: 120, tabs: [{ id: 'botNotes', kind: 'notes' }] },
        columns: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ({ id, cells: [{ id: `${id}k`, tabs: [{ id: `${id}t`, kind: 'notes' as const }] }] })),
      }],
    })
    const top = await box(wsBand(page, 'top'))
    const bottom = await box(wsBand(page, 'bottom'))
    expect(Math.round(top.width)).toBe(1100 - 12)
    const columns = page.locator('[data-ws-columns]')
    const scroll = await columns.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(scroll.sw).toBeGreaterThan(scroll.cw)
    await columns.evaluate((el) => { el.scrollLeft = 400 })
    await expect.poll(() => columns.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expect(await box(wsBand(page, 'top'))).toEqual(top)
    expect(await box(wsBand(page, 'bottom'))).toEqual(bottom)
    expect(await page.locator('[data-ws-area]').evaluate((el) => el.scrollLeft)).toBe(0)
  })

  test('unsaved band changes come back after a reload, still unsaved', async ({ page }) => {
    await seedWorkspace(page, { layouts: [threeCells] })
    const a = await areaBox(page)
    await dragPanel(page, 'b2', { x: a.x + 300, y: a.y + 3 })
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['dashTab'])
    await page.reload()
    await expect.poll(() => wsBandTabs(page, 'top')).toEqual(['dashTab'])
    await expect(saveButton(page)).toHaveAccessibleName(UNSAVED)
    expect((await readStore(page, 'layouts'))[0]?.top).toBeUndefined()
  })

  test('Edit list for a list tab in a band opens on screen', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Team', predicate: { searchText: 'a' } }],
      tasks: [{ title: 'Alpha' }],
      layouts: [{ ...threeCells, top: { id: 'tb', height: 220, tabs: [{ id: 'bandList', kind: 'lens', listDefIdx: 0 }] } }],
    })
    await expect(wsListWidget(page, 'bandList')).toBeVisible()
    await wsTab(page, 'bandList').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit list…' }).click()
    const popover = page.getByTestId('edit-list')
    await expect(popover).toHaveAttribute('data-placement', 'below')
    await expectInsideViewport(page, popover, 0)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('bands are pager pages: the top band first, the bottom band last, named with a band glyph', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        ...threeCells,
        top: { id: 'tb', tabs: [{ id: 'topDash', kind: 'dashboard' }] },
        bottom: { id: 'bb', tabs: [{ id: 'botCal', kind: 'calendar' }] },
      }],
    })
    const names = page.getByRole('tablist', { name: 'Columns' }).getByRole('tab')
    await expect(names).toHaveText(['Dashboard', 'Notes', 'Calendar', 'Calendar'])
    await expect(names.first()).toHaveAttribute('data-ws-band-name', 'top')
    await expect(names.last()).toHaveAttribute('data-ws-band-name', 'bottom')
    await expect(names.first().locator('svg')).toBeVisible()
    await expect(page.locator('[data-ws-band-page="top"] [data-ws-tab="topDash"]')).toBeInViewport()
    await names.last().click()
    await expect(page.locator('[data-ws-band-page="bottom"] [data-ws-tab="botCal"]')).toBeInViewport()
    await expect(names.last()).toHaveAttribute('aria-selected', 'true')
  })
})

