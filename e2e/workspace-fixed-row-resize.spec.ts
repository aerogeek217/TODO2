import { expect, test, type Page } from '@playwright/test'
import { edges, expectLayoutStored, releaseDrag, seedWorkspace, wsCell, wsDivider, type WsLayoutSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A divider moves only its own line (J14): beside a Numbers-only (fit) row
 * or a fixed (`px`) row, the track across the dragged line gives or takes
 * the px, every other line stays where it was, and the divider follows the
 * pointer 1:1 — a weighted row elsewhere in the table keeps its height.
 */

/** A weighted row, a fit row of two Numbers, a weighted row. */
const sandwich: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a a', 'n1 n2', 'b b'],
    cells: [
      { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
      { id: 'n1', tabs: [{ id: 'num1', kind: 'number' }] },
      { id: 'n2', tabs: [{ id: 'num2', kind: 'number' }] },
      { id: 'b', tabs: [{ id: 'bTab', kind: 'notes' }] },
    ],
  },
}

/** A fixed 160px row between two weighted rows. */
const fixedMiddle: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a', 'f', 'b'],
    rows: [1000, { px: 160 }, 1000],
    cells: ['a', 'f', 'b'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
  },
}

/** Every row line's y (the cells' tops and the last one's bottom), top to bottom. */
async function rowLines(page: Page, ids: readonly string[]): Promise<number[]> {
  const out: number[] = []
  for (const id of ids) out.push((await edges(wsCell(page, id))).top)
  const last = ids.at(-1)
  if (last) out.push((await edges(wsCell(page, last))).bottom)
  return out
}

/** Drags a row divider straight down by `dy` px (a trusted mouse, 12 steps). */
async function dragDivider(page: Page, before: string, after: string, dy: number): Promise<void> {
  const b = await box(wsDivider(page, before, after))
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + dy, { steps: 12 })
  await releaseDrag(page)
}

/** `after` is `before` with line `moved` shifted by `dy`; every other line within 1px of where it was. */
function expectOnlyLineMoved(before: number[], after: number[], moved: number, dy: number): void {
  for (let i = 0; i < before.length; i++) {
    const want = (before[i] ?? 0) + (i === moved ? dy : 0)
    expect(Math.abs((after[i] ?? 0) - want), `line ${i}: ${before[i]} → ${after[i]}, want ${want}`).toBeLessThanOrEqual(1)
  }
}

test.describe('a fit row between weighted rows', () => {
  const cells = ['a', 'n1', 'b'] as const

  test('dragging its bottom divider moves only that line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sandwich] })
    const before = await rowLines(page, cells)
    await dragDivider(page, 'n1', 'b', 60)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 60))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 60)
    // Upwards again: the same line, back, the rest still put.
    await dragDivider(page, 'n1', 'b', -40)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 20))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 20)
  })

  test('dragging its top divider moves only that line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sandwich] })
    const before = await rowLines(page, cells)
    await dragDivider(page, 'a', 'n1', -60)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[1] ?? 0)).toBe(Math.round((before[1] ?? 0) - 60))
    expectOnlyLineMoved(before, await rowLines(page, cells), 1, -60)
  })

  test('mid-drag the line follows the pointer alone; Esc puts every line back', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sandwich] })
    const before = await rowLines(page, cells)
    const b = await box(wsDivider(page, 'n1', 'b'))
    const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x, from.y + 70, { steps: 12 })
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 70))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 70)
    await page.keyboard.press('Escape')
    await releaseDrag(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round(before[2] ?? 0))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 0)
  })

  test('the arrow keys step only the focused divider\'s line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sandwich] })
    const before = await rowLines(page, cells)
    await wsDivider(page, 'n1', 'b').focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 16))
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 32))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 32)
  })

  test('a double-click lets it fit again, the clicked line moving and the other staying', async ({ page }) => {
    await seedWorkspace(page, { layouts: [sandwich] })
    const fit = await rowLines(page, cells)
    await dragDivider(page, 'n1', 'b', 80)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((fit[2] ?? 0) + 80))
    const tall = await rowLines(page, cells)
    const d = await box(wsDivider(page, 'n1', 'b'))
    await page.mouse.dblclick(d.x + d.width / 2, d.y + d.height / 2)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round(fit[2] ?? 0))
    // Its top line and the table's ends where they were before the double-click.
    expectOnlyLineMoved(tall, await rowLines(page, cells), 2, (fit[2] ?? 0) - (tall[2] ?? 0))
  })
})

test.describe('a fit row\'s line through a crossing', () => {
  /** `a c / n1 n2 / b d`: "+" crossings on both of the fit row's lines. */
  const quad: WsLayoutSeed = {
    name: 'Main',
    table: {
      areas: ['a c', 'n1 n2', 'b d'],
      cells: [
        ...['a', 'c', 'b', 'd'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
        { id: 'n1', tabs: [{ id: 'num1', kind: 'number' }] },
        { id: 'n2', tabs: [{ id: 'num2', kind: 'number' }] },
      ],
    },
  }
  const cells = ['a', 'n1', 'b'] as const

  test('dragging the crossing down moves only the fit row\'s bottom line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    const before = await rowLines(page, cells)
    const x = await box(page.locator('[data-ws-crossing][data-row="2"]'))
    const from = { x: x.x + x.width / 2, y: x.y + x.height / 2 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x, from.y + 50, { steps: 12 })
    await releaseDrag(page)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 50))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 50)
  })
})

test.describe('a fixed row between weighted rows', () => {
  const cells = ['a', 'f', 'b'] as const

  test('dragging either divider moves only that line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [fixedMiddle] })
    const before = await rowLines(page, cells)
    await dragDivider(page, 'f', 'b', 50)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[2] ?? 0)).toBe(Math.round((before[2] ?? 0) + 50))
    expectOnlyLineMoved(before, await rowLines(page, cells), 2, 50)

    const mid = await rowLines(page, cells)
    await dragDivider(page, 'a', 'f', 40)
    await expectLayoutStored(page)
    await expect.poll(async () => Math.round((await rowLines(page, cells))[1] ?? 0)).toBe(Math.round((mid[1] ?? 0) + 40))
    expectOnlyLineMoved(mid, await rowLines(page, cells), 1, 40)
  })
})
