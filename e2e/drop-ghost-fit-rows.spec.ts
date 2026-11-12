import { test, type Page } from '@playwright/test'
import { drag, edges, expectSameEdges, seedWorkspace, wsCell, wsGhost, type WsLayoutSeed } from './fixtures/workspace'
import { box, pointIn, type Point } from './fixtures/geometry'

/**
 * The drop ghost is where the dropped cell lands, at its size, beside and
 * across a Numbers (fit) row (widget feedback 2D): a fit row's height is
 * its content's, so the ghost places a row a drop leaves holding only
 * Numbers, and a new fit row, at the height the browser then draws — not at
 * its old weighted height or a nominal one. Each case drags by the grip (a
 * whole cell) or a tab, reads the ghost while over the target and checks it
 * against the cell that holds what was dragged after the drop.
 */

test.use({ viewport: { width: 1280, height: 800 } })

const number = (id: string, metric: string) => ({ id, kind: 'number' as const, glance: { metric } })

/** `[n1 n2 n3]` (a Numbers row) over `[a b c]`. */
const NUMBERS_OVER_CELLS: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['n1 n2 n3', 'a b c'],
    cells: [
      { id: 'n1', tabs: [number('num1', 'open')] },
      { id: 'n2', tabs: [number('num2', 'overdue')] },
      { id: 'n3', tabs: [number('num3', 'focus')] },
      { id: 'a', tabs: [{ id: 'notesA', kind: 'notes' }] },
      { id: 'b', tabs: [{ id: 'notesB', kind: 'notes' }] },
      { id: 'c', tabs: [{ id: 'calTab', kind: 'calendar' }] },
    ],
  },
}

async function grip(page: Page, cellId: string): Promise<Point> {
  await wsCell(page, cellId).hover()
  return pointIn(wsCell(page, cellId).getByTestId('ws-cell-grip'))
}

/** Drags from `from` to `to`, then checks the ghost seen there against the cell holding tab `tabId` after the drop. */
async function expectGhostIsLanding(page: Page, from: Point, to: Point, tabId: string): Promise<void> {
  let ghost = { left: 0, top: 0, right: 0, bottom: 0 }
  await drag(page, from, to, {
    during: async () => {
      await wsGhost(page).waitFor()
      ghost = await edges(wsGhost(page))
    },
  })
  const landed = page.locator(`[data-ws-cell]:has([data-ws-tab="${tabId}"])`).first()
  await landed.waitFor()
  expectSameEdges(ghost, await edges(landed))
}

const CASES: Array<{ name: string; from: string; tab: string; to: string; at: [number, number] }> = [
  { name: 'a Number onto a Number’s right', from: 'n1', tab: 'num1', to: 'n2', at: [0.95, 0.5] },
  { name: 'a Number onto a Number’s left', from: 'n1', tab: 'num1', to: 'n3', at: [0.05, 0.5] },
  { name: 'a Number below a Number (a new fit row)', from: 'n1', tab: 'num1', to: 'n2', at: [0.5, 0.95] },
  { name: 'a Number onto a tall cell’s left', from: 'n1', tab: 'num1', to: 'b', at: [0.05, 0.5] },
  { name: 'a Number onto a tall cell’s right', from: 'n2', tab: 'num2', to: 'c', at: [0.95, 0.5] },
  { name: 'a tall cell onto a Number’s left', from: 'b', tab: 'notesB', to: 'n3', at: [0.05, 0.5] },
  { name: 'a tall cell onto a Number’s right', from: 'a', tab: 'notesA', to: 'n1', at: [0.95, 0.5] },
  { name: 'a tall cell onto a tall cell’s right', from: 'b', tab: 'notesB', to: 'c', at: [0.95, 0.5] },
  { name: 'a tall cell above a tall cell', from: 'b', tab: 'notesB', to: 'c', at: [0.5, 0.03] },
]

for (const c of CASES) {
  test(`${c.name}: the ghost is where it lands`, async ({ page }) => {
    await seedWorkspace(page, { layouts: [NUMBERS_OVER_CELLS] })
    await expectGhostIsLanding(page, await grip(page, c.from), await pointIn(wsCell(page, c.to), c.at[0], c.at[1]), c.tab)
  })
}

test('a Number inserted as a column at the layout’s left edge: full height', async ({ page }) => {
  await seedWorkspace(page, { layouts: [NUMBERS_OVER_CELLS] })
  const area = await box(page.locator('[data-ws-area]'))
  await expectGhostIsLanding(page, await grip(page, 'n2'), { x: area.x + 10, y: area.y + area.height / 2 }, 'num2')
})

test('a Number inserted as a row at the layout’s top edge: a fit row', async ({ page }) => {
  await seedWorkspace(page, { layouts: [NUMBERS_OVER_CELLS] })
  const area = await box(page.locator('[data-ws-area]'))
  await expectGhostIsLanding(page, await grip(page, 'b'), { x: area.x + area.width / 2, y: area.y - 6 }, 'notesB')
})

test('a cell dragged out of a row leaves it holding only a Number: the other rows take the room (the ghost too)', async ({ page }) => {
  // [n1 x] over [a c]: the first row isn't a fit row until x leaves it.
  await seedWorkspace(page, { layouts: [{ name: 'Main', table: { areas: ['n1 x', 'a c'], cells: [
    { id: 'n1', tabs: [number('num1', 'open')] },
    { id: 'x', tabs: [{ id: 'notesX', kind: 'notes' }] },
    { id: 'a', tabs: [{ id: 'notesA', kind: 'notes' }] },
    { id: 'c', tabs: [{ id: 'calTab', kind: 'calendar' }] },
  ] } }] })
  await expectGhostIsLanding(page, await grip(page, 'x'), await pointIn(wsCell(page, 'c'), 0.95, 0.5), 'notesX')
})

test('a Number tab dragged out of a two-Number cell leaves a Numbers row: the ghost below it is full height', async ({ page }) => {
  await seedWorkspace(page, { layouts: [{ name: 'Main', table: { areas: ['nn n2', 'a c'], cells: [
    { id: 'nn', tabs: [number('numA', 'open'), number('numB', 'overdue')] },
    { id: 'n2', tabs: [number('num2', 'focus')] },
    { id: 'a', tabs: [{ id: 'notesA', kind: 'notes' }] },
    { id: 'c', tabs: [{ id: 'calTab', kind: 'calendar' }] },
  ] } }] })
  await expectGhostIsLanding(page, await pointIn(page.locator('[data-ws-tab="numB"]')), await pointIn(wsCell(page, 'a'), 0.95, 0.5), 'numB')
})
