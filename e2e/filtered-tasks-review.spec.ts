import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { expectOpenLayout, reviewField, seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { openFilterPicker } from './fixtures/filters'

/**
 * The filtered-tasks panel (the top bar's `N of M` counter) offers Review
 * these N tasks beside Copy tasks: a jump with the top bar's chips and its
 * text search as its filter — the panel closes. With no Review widget on the
 * open layout (another layout's is left alone) it opens the popup review.
 * The phone's screen-filter dialog offers it too.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Ann plan', people: ['Ann'] },
    { title: 'Ann call', people: ['Ann'] },
    { title: 'Bob task', people: ['Bob'] },
    { title: 'Ann report', people: ['Ann'] },
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
    // Where the jump goes: a Review widget filling the window (its large face, the queue beside the card).
    { name: 'Review', columns: [{ id: 'r1', rows: [wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] })] }] },
  ],
}

const NO_WIDGET: WorkspaceSeed = {
  ...SEED,
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const panel = (page: Page) => page.locator('[data-filter-panel]')
const reviewButton = (page: Page) => panel(page).getByRole('button', { name: /^Review these \d+ tasks$/ })

async function openPanelOnAnn(page: Page, seed: WorkspaceSeed = SEED) {
  await seedWorkspace(page, seed)
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toHaveLength(4)
  await openFilterPicker(page, 'People')
  await page.getByRole('option', { name: 'Ann' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('header').getByRole('button', { name: '3 of 4 open tasks shown. Show them' }).click()
  await expect(panel(page)).toBeVisible()
}

test.use({ viewport: { width: 1280, height: 800 } })

test('Review these 3 tasks opens the popup review with the top bar’s filter (no layout switch); the panel closes; its queue is the panel’s tasks', async ({ page }) => {
  await openPanelOnAnn(page)
  const listed = await rowTitles(panel(page))
  expect(listed).toHaveLength(3)
  await expect(reviewButton(page)).toHaveText('Review these 3 tasks')

  await reviewButton(page).click()
  await expect(panel(page)).toHaveCount(0)
  await expectOpenLayout(page, 'Main')
  await expect(page.getByTestId('widget-popup')).toBeVisible()
  await expect(reviewField(page, 'review-popup')).toHaveValue('@Ann')
  const widget = page.locator('[data-review-widget="review-popup"]')
  await expect(widget.locator('[data-review-row]')).toHaveCount(3)
  for (const title of listed) await expect(widget.locator('[data-review-row]').filter({ hasText: title })).toHaveCount(1)
  // The focus moved into the widget: the card's update line.
  await expect(widget.getByLabel('Status update · today')).toBeFocused()
})

test('the text search comes along as a quoted phrase', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await page.locator('header').getByPlaceholder('Filter…').fill('report')
  await page.locator('header').getByRole('button', { name: /^1 of 4 open tasks shown/ }).click()
  await expect(panel(page)).toBeVisible()
  await reviewButton(page).or(panel(page).getByRole('button', { name: 'Review this task' })).click()
  await expect(reviewField(page, 'review-popup')).toHaveValue('"report"')
  await expect(page.locator('[data-review-widget="review-popup"]').getByTestId('review-card-title')).toHaveText('Ann report')
})

test('no layout has a Review widget: the Review button is there and opens the popup review', async ({ page }) => {
  await openPanelOnAnn(page, NO_WIDGET)
  await expect(panel(page).getByRole('button', { name: /^Copy tasks/ })).toBeVisible()
  await reviewButton(page).click()
  await expect(reviewField(page, 'review-popup')).toHaveValue('@Ann')
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the screen filter’s task dialog offers Review, which opens the popup review on the full screen', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('dialog', { name: 'Filters' }).getByPlaceholder('Filter…').fill('ann')
    await page.getByRole('button', { name: 'Show 3 tasks' }).click()
    const dialog = page.locator('[data-task-dialog]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Copy tasks/ })).toBeVisible()
    await dialog.getByRole('button', { name: 'Review these 3 tasks' }).click()
    await expect(dialog).toHaveCount(0)
    const popup = page.getByTestId('widget-popup')
    await expect(popup).toBeVisible()
    await expect(reviewField(page, 'review-popup')).toHaveValue('"ann"')
    const box = await popup.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(389)
    // The Review widget's medium face, as the phone's cells show it.
    await expect(page.locator('[data-review-widget="review-popup"]')).toHaveAttribute('data-review-face', 'medium')
  })
})
