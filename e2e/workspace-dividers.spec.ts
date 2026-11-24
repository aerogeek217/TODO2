import { expect, test, type Locator, type Page } from '@playwright/test'
import { edges, expectSameEdges, openCellMenu, releaseDrag, seedWorkspace, wsCell, wsDivider, type WsLayoutSeed, expectDividerStep, expectLayoutStored, newestUndoStep } from './fixtures/workspace'
import { box, dividerGrip, type Point } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Dividers in a real browser (D26 follow-ups, board BE; layout edit mode
 * E4, decision B): a line parts at its "+" crossings into pieces, a divider
 * each — and a plain drag of any piece moves the **whole line** across the
 * crossing, while an Alt-drag breaks the piece off into a new line; there
 * are no crossing handles. An Alt-dragged piece near another column's line
 * snaps onto it — a faint guide along that line — and re-joins it; a
 * Numbers-only row gets a divider that gives it a height.
 */


/** `a b / c d`: four Notes cells meeting at one "+". */
const quad: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b', 'c d'],
    cells: ['a', 'b', 'c', 'd'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
  },
}

function crossing(page: Page): Locator {
  return page.locator('[data-ws-crossing]')
}


/**
 * A trusted-mouse drag of a resize handle: presses at `from`, moves to `to`
 * in 12 steps, checks `during`, lets go — with Alt held throughout when
 * `alt` (an Alt-drag: the piece breaks off its line).
 */
async function dragHandle(page: Page, from: Point, to: Point, during?: () => Promise<void>, { alt = false }: { alt?: boolean } = {}): Promise<void> {
  await page.mouse.move(from.x, from.y)
  if (alt) await page.keyboard.down('Alt')
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (during) await during()
  await releaseDrag(page)
  if (alt) await page.keyboard.up('Alt')
}

const opacity = (l: Locator) => l.evaluate((el) => getComputedStyle(el).opacity)

type StoredRow = { id: string; weight?: number; px?: number; fitPx?: number }

async function storedRows(page: Page): Promise<StoredRow[]> {
  const row = (await readStore<{ grid: { rows: StoredRow[] } }>(page, 'layouts'))[0]
  return row?.grid.rows ?? []
}

test.describe('pieces and whole lines', () => {
  test('a 2×2 parts its lines at the "+": four pieces, no crossing handle', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    await expect(page.locator('[data-ws-divider][data-axis="columns"]')).toHaveCount(2)
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveCount(2)
    await expect(crossing(page)).toHaveCount(0)
    await expect(wsDivider(page, 'a', 'b')).toHaveAttribute('data-tooltip', 'Drag to resize · Alt-drag to split the line')
  })

  test('a plain drag of one piece moves the whole line across the crossing: view state, saved at once, no undo step', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    const a0 = await edges(wsCell(page, 'a'))
    const from = dividerGrip(await box(wsDivider(page, 'a', 'c')))
    await dragHandle(page, from, { x: from.x, y: from.y + 80 })
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - a0.bottom)).toBeGreaterThan(70)
    // The whole line: b follows a across the "+", d shrinks from its top.
    const a1 = await edges(wsCell(page, 'a'))
    expect(Math.abs((await edges(wsCell(page, 'b'))).bottom - a1.bottom)).toBeLessThanOrEqual(1)
    expect(Math.abs((await edges(wsCell(page, 'd'))).top - (await edges(wsCell(page, 'c'))).top)).toBeLessThanOrEqual(1)
    await expect(page.locator('[data-ws-divider][data-axis="rows"]')).toHaveCount(2)
    await expectLayoutStored(page)
    await expect.poll(async () => (await storedRows(page)).map((r) => Math.round(r.weight ?? 0))).not.toEqual([1000, 1000])
    expect(await newestUndoStep(page)).toBeNull()
  })

  test('an Alt-drag of a piece breaks it off: a new line, saved at once, an undo step', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    const a0 = await edges(wsCell(page, 'a'))
    const c0 = await edges(wsCell(page, 'c'))
    const from = dividerGrip(await box(wsDivider(page, 'a', 'b')))
    await dragHandle(page, from, { x: from.x + 100, y: from.y }, async () => {
      await expect(wsDivider(page, 'a', 'b')).toHaveAttribute('data-break', '')
    }, { alt: true })
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).right - a0.right)).toBeGreaterThan(90)
    // c | d stays (a new track takes one more gap from the weighted columns: a few px).
    expect(Math.abs((await edges(wsCell(page, 'c'))).right - c0.right)).toBeLessThanOrEqual(4)
    await expectDividerStep(page)
  })

  test('hovering a piece lights its whole line; with Alt only the piece', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    const divider = wsDivider(page, 'a', 'c')
    const line = page.locator('[data-ws-divider-line="a|c"]')
    expect(await opacity(line)).toBe('0')
    const at = dividerGrip(await box(divider))
    await page.mouse.move(at.x, at.y)
    await expect.poll(() => opacity(line)).toBe('1')
    // Across the whole table.
    const table = await box(page.locator('[data-ws-table]'))
    expect((await box(line)).width).toBeGreaterThan(table.width - 24)
    await page.keyboard.down('Alt')
    await expect(divider).toHaveAttribute('data-break', '')
    await expect.poll(() => opacity(line)).toBe('0')
    await page.keyboard.up('Alt')
    await expect.poll(() => opacity(line)).toBe('1')
    await page.mouse.move(table.x + 40, table.y + 40)
    await expect.poll(() => opacity(line)).toBe('0')
  })

  test('the keys: an arrow steps the whole line 16px, Alt + an arrow the piece; a double-click evens the whole line', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    const a0 = await edges(wsCell(page, 'a'))
    const b0 = await edges(wsCell(page, 'b'))
    await wsDivider(page, 'a', 'c').focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - a0.bottom)).toBe(16)
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'b'))).bottom - b0.bottom)).toBe(16)
    const at = dividerGrip(await box(wsDivider(page, 'a', 'c')))
    await page.mouse.dblclick(at.x, at.y)
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - a0.bottom)).toBe(0)
    await wsDivider(page, 'a', 'c').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - a0.bottom)).toBeGreaterThan(10)
    // b stays: the piece left the line.
    expect(Math.abs((await edges(wsCell(page, 'b'))).bottom - b0.bottom)).toBeLessThanOrEqual(4)
    await expect(wsDivider(page, 'a', 'c')).toBeFocused()
  })
})

test.describe('snapping', () => {
  test('an Alt-dragged piece snaps onto the other column\'s line (a guide shows), re-joins it, and a plain drag then moves both pieces', async ({ page }) => {
    await seedWorkspace(page, { layouts: [quad] })
    const a0 = await edges(wsCell(page, 'a'))

    // 1. The right column's row piece down 80px: the two columns' row pieces at different heights.
    let from = dividerGrip(await box(wsDivider(page, 'b', 'd')))
    await dragHandle(page, from, { x: from.x, y: from.y + 80 }, undefined, { alt: true })
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'b'))).bottom - a0.bottom)).toBeGreaterThan(70)
    await expectDividerStep(page)
    expect(Math.abs((await edges(wsCell(page, 'a'))).bottom - a0.bottom)).toBeLessThanOrEqual(4)

    // 2. Back up to within a few px of the left column's line: it snaps, the guide shows along that line.
    from = dividerGrip(await box(wsDivider(page, 'b', 'd')))
    const aBottom = (await edges(wsCell(page, 'a'))).bottom
    const bBottom = (await edges(wsCell(page, 'b'))).bottom
    await dragHandle(page, from, { x: from.x, y: from.y - (bBottom - aBottom) + 5 }, async () => {
      const guide = page.getByTestId('ws-snap-guide')
      await expect(guide).toBeVisible()
      await expect(guide).toHaveAttribute('data-axis', 'rows')
      // Along the whole line, across the table.
      const g = await box(guide)
      const table = await box(page.locator('[data-ws-table]'))
      expect(g.width).toBeGreaterThan(table.width - 24)
    }, { alt: true })
    await expect(page.getByTestId('ws-snap-guide')).toHaveCount(0)
    // Re-joined: one row line through both columns again — the layout as saved.
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'b'))).bottom)).toBe(Math.round((await edges(wsCell(page, 'a'))).bottom))
    await expectLayoutStored(page)

    // 3. A plain drag of the left piece: both pieces move together (the whole line), the column line stays put.
    const before = await edges(wsCell(page, 'a'))
    const bBefore = await edges(wsCell(page, 'b'))
    const x = dividerGrip(await box(wsDivider(page, 'a', 'c')))
    await dragHandle(page, x, { x: x.x, y: x.y + 70 })
    await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).bottom - before.bottom)).toBeGreaterThan(60)
    const after = await edges(wsCell(page, 'a'))
    expect(Math.abs((await edges(wsCell(page, 'b'))).bottom - after.bottom)).toBeLessThanOrEqual(1)
    expect((await edges(wsCell(page, 'b'))).bottom - bBefore.bottom).toBeGreaterThan(60)
    expect(after.right).toBeCloseTo(before.right, 0)
    await expectLayoutStored(page)
  })
})

test.describe('a structural drag previews its result', () => {
  /** `a b b / d e f`: the a|b piece (left of the "+") can snap onto the e|f line. */
  const steps: WsLayoutSeed = {
    name: 'Main',
    table: {
      areas: ['a b b', 'd e f'],
      cells: ['a', 'b', 'd', 'e', 'f'].map((id) => ({ id, tabs: [{ id: `${id}Tab`, kind: 'notes' as const }] })),
    },
  }

  test('an Alt-dragged piece snapped onto the next line: mid-drag the cells stand where the release puts them, the same elements', async ({ page }) => {
    await seedWorkspace(page, { layouts: [steps] })
    // Marks on the cells' elements: a remount would lose them.
    await page.locator('[data-ws-cell]').evaluateAll((els) => { for (const el of els) (el as HTMLElement & { __mark?: boolean }).__mark = true })
    const marked = () => page.locator('[data-ws-cell]').evaluateAll((els) => els.every((el) => (el as HTMLElement & { __mark?: boolean }).__mark === true))
    const a0 = await edges(wsCell(page, 'a'))
    const from = dividerGrip(await box(wsDivider(page, 'a', 'b')))
    const target = dividerGrip(await box(wsDivider(page, 'e', 'f')))
    const mid: Partial<Record<'a' | 'b', Awaited<ReturnType<typeof edges>>>> = {}
    // To 4px short of the e|f line: it snaps onto it.
    await dragHandle(page, from, { x: target.x - 4, y: from.y }, async () => {
      await expect(page.locator('[data-ws-divider][data-preview]')).toHaveCount(1)
      await expect(page.getByTestId('ws-snap-guide')).toBeVisible()
      // a already reaches the e|f line, b starts there.
      await expect.poll(async () => Math.round((await edges(wsCell(page, 'a'))).right - (await edges(wsCell(page, 'e'))).right)).toBe(0)
      mid.a = await edges(wsCell(page, 'a'))
      mid.b = await edges(wsCell(page, 'b'))
      expect(await marked()).toBe(true)
    }, { alt: true })
    await expectDividerStep(page)
    if (!mid.a || !mid.b) throw new Error('not measured mid-drag')
    expect(mid.a.right - a0.right).toBeGreaterThan(50)
    expectSameEdges(await edges(wsCell(page, 'a')), mid.a, 1)
    expectSameEdges(await edges(wsCell(page, 'b')), mid.b, 1)
    expect(await marked()).toBe(true)
  })

  test('Esc mid-drag puts the table back as it was; nothing changes', async ({ page }) => {
    await seedWorkspace(page, { layouts: [steps] })
    const a0 = await edges(wsCell(page, 'a'))
    const from = dividerGrip(await box(wsDivider(page, 'a', 'b')))
    const target = dividerGrip(await box(wsDivider(page, 'e', 'f')))
    await page.mouse.move(from.x, from.y)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.move(target.x - 4, from.y, { steps: 12 })
    await expect(page.locator('[data-ws-divider][data-preview]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-ws-divider][data-preview]')).toHaveCount(0)
    await releaseDrag(page)
    await page.keyboard.up('Alt')
    expectSameEdges(await edges(wsCell(page, 'a')), a0, 1)
    await expectLayoutStored(page)
  })
})

test.describe('a Numbers-only row', () => {
  const numbers: WsLayoutSeed = {
    name: 'Main',
    table: {
      areas: ['n1 n2', 'a a'],
      cells: [
        { id: 'n1', tabs: [{ id: 'num1', kind: 'number' }] },
        { id: 'n2', tabs: [{ id: 'num2', kind: 'number' }] },
        { id: 'a', tabs: [{ id: 'aTab', kind: 'notes' }] },
      ],
    },
  }

  test('its divider gives it a height (saved at once, kept over a reload); a double-click lets it fit again', async ({ page }) => {
    await seedWorkspace(page, { layouts: [numbers] })
    const fit = Math.round((await box(wsCell(page, 'n1'))).height)
    expect(fit).toBeLessThan(100)
    const divider = page.locator('[data-ws-divider][data-axis="rows"]')
    await expect(divider).toHaveCount(1)
    await expect(divider).toHaveAttribute('data-fit', '')
    const from = dividerGrip(await box(divider))
    await dragHandle(page, from, { x: from.x, y: from.y + 80 })
    await expect.poll(async () => Math.round((await box(wsCell(page, 'n1'))).height)).toBeGreaterThan(fit + 70)
    const tall = Math.round((await box(wsCell(page, 'n1'))).height)
    await expectLayoutStored(page)
    // Its own height (fitPx), beside its weight — never a px.
    await expect.poll(async () => (await storedRows(page))[0]?.fitPx).toBe(tall)
    expect((await storedRows(page))[0]).toMatchObject({ weight: expect.any(Number) as unknown })
    expect((await storedRows(page))[0]?.px).toBeUndefined()
    // Taller than its small face: the medium face.
    await expect(wsCell(page, 'n1')).toHaveAttribute('data-face', 'medium')
    await page.reload()
    await expect.poll(async () => Math.round((await box(wsCell(page, 'n1'))).height)).toBe(tall)

    const d = dividerGrip(await box(divider))
    await page.mouse.dblclick(d.x, d.y)
    await expect.poll(async () => Math.round((await box(wsCell(page, 'n1'))).height)).toBe(fit)
    await expect.poll(async () => (await storedRows(page))[0]?.fitPx).toBeUndefined()
  })

  test('its minimum is its fit height: a press, a jiggle, a drag up or ↑ leave it fitting; given a height it comes back down to it (cr34 W3)', async ({ page }) => {
    await seedWorkspace(page, { layouts: [numbers] })
    const fit = (await box(wsCell(page, 'n1'))).height
    const height = async () => (await box(wsCell(page, 'n1'))).height
    const divider = page.locator('[data-ws-divider][data-axis="rows"]')
    const from = dividerGrip(await box(divider))
    // A press with a 1px jiggle, then a drag up: the row is as tall as it was, and still fits (no height of its own).
    await dragHandle(page, from, { x: from.x, y: from.y - 1 })
    expect(await height()).toBe(fit)
    await dragHandle(page, from, { x: from.x, y: from.y - 40 })
    expect(await height()).toBe(fit)
    await divider.focus()
    await page.keyboard.press('ArrowUp')
    expect(await height()).toBe(fit)
    await expectLayoutStored(page)
    expect((await storedRows(page))[0]?.fitPx).toBeUndefined()
    // ↓ gives it 16px more; a long drag up then stops at the height it fits at.
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => Math.round(await height())).toBe(Math.round(fit) + 16)
    const d = dividerGrip(await box(divider))
    await dragHandle(page, d, { x: d.x, y: d.y - 200 })
    await expect.poll(async () => Math.round(await height())).toBe(Math.round(fit))
  })

  test('collapsed, its cells keep their small face (no top line in the 32px row), given a height or not', async ({ page }) => {
    await seedWorkspace(page, { layouts: [numbers] })
    await expect(wsCell(page, 'n1')).toHaveAttribute('data-face', 'small')
    await openCellMenu(page, 'n1')
    await page.getByRole('menuitem', { name: 'Collapse row' }).click()
    await expect.poll(async () => Math.round((await box(wsCell(page, 'n1'))).height)).toBe(32)
    // The widgets inside draw their small face (the cell itself names no face while folded).
    await expect(wsCell(page, 'n1').locator('[data-glance]')).toHaveAttribute('data-face', 'small')
    await expect(wsCell(page, 'n2').locator('[data-glance]')).toHaveAttribute('data-face', 'small')
  })
})
