import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsRow } from './fixtures/workspace'

/**
 * `data-cell-hot` (cr34 H5): a cell's hover-only controls — the grip and ⋯,
 * a strip's × and + — show while the cell's element
 * carries it, and the cell carries it exactly while its own `:hover` or
 * `:focus-within` matches (`components/workspace/cell-hot`).
 *
 * Why not those pseudo-classes in the stylesheets: with a rule such as
 * `[data-ws-cell]:hover .controls`, the pointer crossing a cell's edge — or
 * the focus moving in or out — made the browser style every row part in the
 * cell again (1,700 elements for a 110-row list, a dropped frame each time).
 * The last two tests pin what a crossing and a focus move may cost.
 */

const TASKS = Array.from({ length: 60 }, (_, i) => ({ title: `Task ${String(i + 1).padStart(2, '0')}`, dueInDays: i % 9 }))

async function seed(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, {
    tasks: TASKS,
    listDefinitions: [{ name: 'Everything' }],
    layouts: [{ name: 'Main', columns: [
      { id: 'c1', rows: [wsRow({ id: 'list', tabs: [{ id: 'all', kind: 'lens', listDefIdx: 0 }] })] },
      { id: 'c2', rows: [wsRow({ id: 'notes', tabs: [{ id: 'n', kind: 'notes' }] })] },
    ] }],
  })
  await expect(wsCell(page, 'list').locator('[data-todo-id]')).toHaveCount(TASKS.length)
}

/** The cell's mark, and what its own pseudo-classes say. */
const state = (cell: Locator) => cell.evaluate((el) => ({
  hot: el.hasAttribute('data-cell-hot'),
  truth: el.matches(':hover') || el.matches(':focus-within'),
}))

const controlsOpacity = (cell: Locator) => cell.locator('[data-cell-controls] > span').last().evaluate((el) => getComputedStyle(el).opacity)

test('the cell is marked exactly while it is hovered or holds the focus, and its controls show by the mark', async ({ page }) => {
  await seed(page)
  const list = wsCell(page, 'list')
  const notes = wsCell(page, 'notes')
  await page.mouse.move(5, 450)
  await expect.poll(() => state(list)).toEqual({ hot: false, truth: false })
  expect(await controlsOpacity(list)).toBe('0')

  // The pointer over it; then over the other cell.
  await list.hover({ position: { x: 200, y: 300 } })
  await expect.poll(() => state(list)).toEqual({ hot: true, truth: true })
  expect(await controlsOpacity(list)).toBe('1')
  await notes.hover({ position: { x: 200, y: 300 } })
  await expect.poll(() => state(list)).toEqual({ hot: false, truth: false })
  await expect.poll(() => state(notes)).toEqual({ hot: true, truth: true })
  expect(await controlsOpacity(list)).toBe('0')

  // The focus in it, the pointer elsewhere; a move inside it; then the focus out of it.
  await list.locator('[data-todo-id]').nth(2).locator('span[data-task-title]').click()
  await page.mouse.move(5, 450)
  await expect.poll(() => state(list)).toEqual({ hot: true, truth: true })
  expect(await controlsOpacity(list)).toBe('1')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => state(list)).toEqual({ hot: true, truth: true })
  await page.getByRole('textbox', { name: 'Filter tasks' }).focus()
  await expect.poll(() => state(list)).toEqual({ hot: false, truth: false })
  expect(await controlsOpacity(list)).toBe('0')
})

test('the focused element removed from the cell, and an overlay opening over a hovered cell, clear the mark as they clear the pseudo-classes', async ({ page }) => {
  await seed(page)
  const list = wsCell(page, 'list')
  await page.mouse.move(5, 450)

  // No event fires when the focused element is removed: the mark still follows.
  await list.evaluate((el) => {
    const probe = document.createElement('button')
    probe.id = 'cell-hot-probe'
    el.append(probe)
    probe.focus()
  })
  await expect.poll(() => state(list)).toEqual({ hot: true, truth: true })
  await page.evaluate(() => document.getElementById('cell-hot-probe')?.remove())
  await expect.poll(() => state(list)).toEqual({ hot: false, truth: false })

  // Settings opens over the hovered cell (the keyboard: the pointer never moves).
  await list.hover({ position: { x: 200, y: 300 } })
  await expect.poll(() => state(list)).toEqual({ hot: true, truth: true })
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  await expect.poll(async () => {
    const s = await state(list)
    return s.hot === s.truth
  }).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeHidden()
  await expect.poll(async () => {
    const s = await state(list)
    return s.hot === s.truth
  }).toBe(true)
})

interface TraceEvent { name: string; ph: string; args?: { elementCount?: number } }

/** The largest style recalc (elements styled) while `act` runs and the page settles after it. */
async function largestRecalc(browser: Browser, page: Page, act: () => Promise<void>): Promise<number> {
  await browser.startTracing(page, { categories: ['devtools.timeline'] })
  await act()
  // Two frames: the recalc the change asks for has run.
  await page.evaluate(() => new Promise<void>((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done())) }))
  const events = (JSON.parse((await browser.stopTracing()).toString('utf8')) as { traceEvents: TraceEvent[] }).traceEvents
  return Math.max(0, ...events.filter((e) => e.name === 'UpdateLayoutTree' && e.ph === 'X').map((e) => e.args?.elementCount ?? 0))
}

/** The pointer parked off the cells, and two frames gone by: nothing pending. (The ambience's stars are styled on their own clock, some 40 elements at a time — well under what these tests allow.) */
async function seedQuiet(page: Page) {
  await seed(page)
  await page.mouse.move(5, 450)
  await page.evaluate(() => new Promise<void>((done) => { requestAnimationFrame(() => requestAnimationFrame(() => done())) }))
}

test('the pointer crossing a 60-row list cell’s edge styles a few elements, not every row part', async ({ page, browser }) => {
  await seedQuiet(page)
  const list = await wsCell(page, 'list').boundingBox()
  const notes = await wsCell(page, 'notes').boundingBox()
  if (!list || !notes) throw new Error('no cells')
  const inList = { x: list.x + list.width / 2, y: list.y + list.height / 2 }
  const inNotes = { x: notes.x + notes.width / 2, y: notes.y + notes.height / 2 }
  await page.mouse.move(inList.x, inList.y)
  // Each row has some 15 parts a row-hover rule names: 60 rows were 900 and more elements per crossing.
  for (let i = 0; i < 3; i++) {
    expect(await largestRecalc(browser, page, () => page.mouse.move(inNotes.x, inNotes.y)), 'list → notes').toBeLessThan(150)
    expect(await largestRecalc(browser, page, () => page.mouse.move(inList.x, inList.y)), 'notes → list').toBeLessThan(150)
  }
})

test('the focus moving into a 60-row list cell and out of it styles a few elements', async ({ page, browser }) => {
  await seedQuiet(page)
  const filter = page.getByRole('textbox', { name: 'Filter tasks' })
  const row = (n: number) => wsCell(page, 'list').locator('[data-todo-id]').nth(n).locator('span[data-task-title]')
  await filter.click()
  for (let i = 0; i < 3; i++) {
    expect(await largestRecalc(browser, page, () => row(2 + i).click()), 'into the cell').toBeLessThan(300)
    expect(await largestRecalc(browser, page, () => filter.click()), 'out of the cell').toBeLessThan(300)
  }
})
