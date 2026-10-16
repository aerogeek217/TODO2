import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget } from './fixtures/workspace'
import { box, expectInsideViewport } from './fixtures/geometry'

/**
 * The row notes popover is placed by `usePopoverAnchor`: it keeps inside the
 * viewport (start-aligned to the notes icon, flipped to end at the icon's
 * right edge near the window's right side, flipped above the icon near the
 * bottom), follows the icon when the list scrolls, and the icon toggles it.
 * Placement is layout-dependent, so a real browser is the authoritative
 * surface.
 */

const MARGIN = 8
const LONG = 'Prepare the quarterly vendor review notes'

/** Three columns; the list sits in the rightmost one, so its rows' notes icons are near the window's right edge. */
async function seedRightColumnList(page: Page, tasks: Parameters<typeof seedWorkspace>[1]['tasks']): Promise<Locator> {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Tasks' }],
    tasks,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'n1', tabs: [{ id: 'notes1', kind: 'notes' }] }] },
        { id: 'c2', cells: [{ id: 'n2', tabs: [{ id: 'cal', kind: 'calendar' }] }] },
        { id: 'c3', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] },
      ],
    }],
  })
  const widget = wsListWidget(page, 'tasks')
  await widget.waitFor({ state: 'visible' })
  return widget
}

test.describe('row notes popover placement', () => {
  test('near the right edge it ends at the notes icon instead of running off the window', async ({ page }) => {
    await seedRightColumnList(page, [{ title: LONG, notes: 'Vendor notes' }])
    const icon = taskRowByTitle(page, LONG).getByRole('button', { name: 'Edit notes' })
    await icon.click()
    const popover = page.getByRole('dialog', { name: 'Task notes' })
    await expect(popover).toBeVisible()

    const vp = page.viewportSize()
    const i = await box(icon)
    const p = await box(popover)
    // Start-aligned at the icon, the popover would have crossed the right edge.
    expect(i.x + p.width).toBeGreaterThan((vp?.width ?? 0) - MARGIN)
    await expectInsideViewport(page, popover)
    // Flipped to end at the icon's right edge, below it.
    expect(Math.abs(p.x + p.width - (i.x + i.width))).toBeLessThan(1)
    expect(p.y).toBeGreaterThanOrEqual(i.y + i.height)
  })

  test('near the bottom it opens above the notes icon', async ({ page }) => {
    const fillers = Array.from({ length: 30 }, (_, n) => ({ title: `Filler task ${n + 1}` }))
    await seedRightColumnList(page, [...fillers, { title: 'Last with notes', notes: 'Bottom notes' }])
    const row = taskRowByTitle(page, 'Last with notes')
    await row.scrollIntoViewIfNeeded()
    const icon = row.getByRole('button', { name: 'Edit notes' })
    const vp = page.viewportSize()
    const i = await box(icon)
    // Below the icon there is no room for the popover's minimum height.
    expect(i.y + i.height + 4 + 180).toBeGreaterThan((vp?.height ?? 0) - MARGIN)

    await icon.click()
    const popover = page.getByRole('dialog', { name: 'Task notes' })
    await expect(popover).toBeVisible()
    await expectInsideViewport(page, popover)
    // Above the icon where it is now (opening may scroll the list a little).
    await expect.poll(async () => (await box(popover)).y + (await box(popover)).height - (await box(icon)).y).toBeLessThanOrEqual(0)
  })

  test('follows the icon when the list scrolls, and the icon closes it again', async ({ page }) => {
    const fillers = Array.from({ length: 30 }, (_, n) => ({ title: `Filler task ${n + 1}` }))
    await seedRightColumnList(page, [{ title: LONG, notes: 'Scroll notes' }, ...fillers])
    const icon = taskRowByTitle(page, LONG).getByRole('button', { name: 'Edit notes' })
    await icon.click()
    const popover = page.getByRole('dialog', { name: 'Task notes' })
    await expect(popover).toBeVisible()
    const before = await box(popover)

    // Scroll the list (the row's scrolling ancestor) by a few rows.
    await icon.evaluate((el) => {
      let node: HTMLElement | null = el.parentElement
      while (node && !(node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== 'visible')) {
        node = node.parentElement
      }
      if (!node) throw new Error('no scrolling ancestor')
      node.scrollTop += 40
    })
    await expect.poll(async () => (await box(icon)).y).toBeLessThan(before.y - 20)
    await expect(popover).toBeVisible()
    const i = await box(icon)
    await expect.poll(async () => Math.round((await box(popover)).y - (i.y + i.height))).toBe(4)

    await icon.click()
    await expect(popover).toHaveCount(0)
  })
})
