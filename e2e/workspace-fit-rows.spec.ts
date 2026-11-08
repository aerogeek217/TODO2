import { expect, test, type Page } from '@playwright/test'
import { drag, dragTab, pickSplit, seedWorkspace, wsCell, wsShape, wsTab, wsRow, type WsLayoutSeed } from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'

// D26 P2: drops and dividers around a fit row track are the table hit test, ghost and dividers.
test.fixme(true, 'D26 P2')

/**
 * Fit rows (a Number's) among weighted rows, in a real browser (cr33 M8): a
 * Number row added between two rows takes none of their height — dropped on
 * a row's edge or put in a Split ▸ Below cell — and the two rows keep a
 * divider across it.
 */

test.use({ viewport: { width: 1280, height: 900 } })

function bodyPoint(page: Page, cellId: string, fx: number, fy: number): Promise<Point> {
  return pointIn(wsCell(page, cellId).locator('[data-ws-cell-body]'), fx, fy)
}

async function height(page: Page, cellId: string): Promise<number> {
  return (await box(wsCell(page, cellId))).height
}

/** [colA: (ka: notesA) (kb: notesB)] [colB: (kc: numTab), (kd: calTab)] */
const twoRows: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'ka', tabs: [{ id: 'notesA', kind: 'notes' }] }), wsRow({ id: 'kb', tabs: [{ id: 'notesB', kind: 'notes' }] })] },
    { id: 'colB', rows: [wsRow({ id: 'kc', tabs: [{ id: 'numTab', kind: 'number' }] }), wsRow({ id: 'kd', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
  ],
}

test.describe('a fit row between two rows (M8)', () => {
  test('a Number dropped on a row’s bottom zone leaves the two rows their heights', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoRows] })
    const before = await height(page, 'ka')
    expect(Math.abs(before - await height(page, 'kb'))).toBeLessThanOrEqual(1)
    // The Number's tab (its strip slides in on hover) onto ka's bottom zone.
    await wsCell(page, 'kc').hover()
    await expect(wsCell(page, 'kc').locator('[data-ws-cell-header]')).toHaveCSS('opacity', '1')
    await dragTab(page, wsTab(page, 'numTab'), await bodyPoint(page, 'ka', 0.5, 0.9))
    await expect.poll(() => wsShape(page)).toEqual([[['notesA'], ['numTab'], ['notesB']], [['calTab']]])
    await expect(page.locator('[data-ws-column="colA"] [data-fit="true"]')).toHaveCount(1)
    await expect.poll(async () => Math.abs(await height(page, 'ka') - await height(page, 'kb'))).toBeLessThanOrEqual(1)
  })

  test('Split ▸ Below and a Number in the new cell: the split row gets its height back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [twoRows] })
    await wsCell(page, 'ka').locator('[data-ws-cell-header]').hover()
    await wsCell(page, 'ka').getByRole('button', { name: 'Cell options' }).click()
    await pickSplit(page, 'Below')
    const empty = page.getByRole('region', { name: 'Empty cell' })
    await empty.getByRole('button', { name: 'Number', exact: true }).click()
    await expect(page.locator('[data-ws-column="colA"] [data-fit="true"]')).toHaveCount(1)
    await expect.poll(async () => Math.abs(await height(page, 'ka') - await height(page, 'kb'))).toBeLessThanOrEqual(1)
  })

  test('the two rows keep a divider across the fit row: it resizes them, the Number row moves with it', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        columns: [{ id: 'colA', rows: [
          wsRow({ id: 'ka', tabs: [{ id: 'notesA', kind: 'notes' }] }),
          wsRow({ id: 'kn', tabs: [{ id: 'numTab', kind: 'number' }] }),
          wsRow({ id: 'kb', tabs: [{ id: 'notesB', kind: 'notes' }] }),
        ] }],
      }],
    })
    const dividers = page.getByRole('separator', { name: 'Resize rows' })
    await expect(dividers).toHaveCount(1)
    const divider = page.locator('[data-ws-divider="ka-r|kb-r"]')
    await expect(divider).toHaveCount(1)
    // It sits right under the upper row.
    const d = await box(divider)
    const a = await box(wsCell(page, 'ka'))
    expect(d.y).toBeGreaterThanOrEqual(a.y + a.height - 1)
    expect(d.y).toBeLessThan((await box(wsCell(page, 'kn'))).y)

    const [aBefore, nBefore, bBefore] = [a.height, await height(page, 'kn'), await height(page, 'kb')]
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2, y: d.y + d.height / 2 + 100 - 8 })
    await expect.poll(async () => Math.round(await height(page, 'ka') - aBefore)).toBeGreaterThan(80)
    expect(Math.round(bBefore - await height(page, 'kb'))).toBeGreaterThan(80)
    expect(Math.abs(await height(page, 'kn') - nBefore)).toBeLessThanOrEqual(1)
  })
})
