import { expect, test, type Page } from '@playwright/test'
import { reviewField, seedWorkspace, wsCell, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * The Neglect map's Review buttons in a real browser: beside a zone's word
 * (shown while the pointer is on the map) and over the list, each opens the
 * popup review on the zone written as an expression — even with a Review
 * widget on the layout, which keeps reviewing what it was. The review's
 * queue is the zone's count. Stale after is 14 days here.
 */

const SEED: WorkspaceSeed = {
  settings: { staleAfterDays: '14' },
  statuses: ['Parked'],
  tasks: [
    { title: 'Ship the quarterly report', dueInDays: -4, modifiedInDays: -26 },
    { title: 'Renew the vendor contract', dueInDays: 20, followupInDays: -2, modifiedInDays: -30 },
    { title: 'Call the auditor', dueInDays: 1, modifiedInDays: -18 },
    { title: 'Parked and late', dueInDays: -2, modifiedInDays: -40, status: 'Parked' },
    { title: 'Draft the launch plan', dueInDays: -1, modifiedInDays: -2 },
    { title: 'Archive old tickets', modifiedInDays: -50 },
    { title: 'Planned only', doInDays: 2, modifiedInDays: -50 },
  ],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [
      wsRow({ id: 'k1', tabs: [{ id: 'map', kind: 'neglect' }] }),
      wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] }),
    ] }],
  }],
}

const map = (page: Page) => wsCell(page, 'k1').locator('[data-neglect-map]')
const popupRows = (page: Page) => page.locator('[data-review-widget="review-popup"] [data-review-row]')

test.use({ viewport: { width: 1440, height: 1100 } })

test.beforeEach(async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(map(page)).toBeVisible()
})

test('a zone’s Review opens the popup review on the zone as an expression, even with a Review widget on the layout', async ({ page }) => {
  // Beside the plot's Slipping word: shown while the pointer is on the map. Four slip; the planned-only task is off the map.
  const plot = map(page).getByRole('group', { name: /^Neglect map/ })
  const plotReview = plot.getByRole('button', { name: 'Review the 4 slipping tasks' })
  await expect(plotReview).toHaveCSS('opacity', '0')
  await map(page).locator('[data-neglect-chart]').hover({ position: { x: 60, y: 60 } })
  await expect(plotReview).toHaveCSS('opacity', '1')
  await plotReview.click()
  await expect(page.getByTestId('widget-popup')).toBeVisible()
  await expect(reviewField(page, 'review-popup')).toHaveValue('(due soon or followup soon) and stale')
  await expect(popupRows(page)).toHaveCount(4)
  // The layout's own Review widget reviews nothing.
  await expect(reviewField(page, 'rv')).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('widget-popup')).toHaveCount(0)

  // The list's switch to Forgotten, then its header's Review.
  await map(page).getByRole('group', { name: 'List' }).getByRole('button', { name: /^Forgotten/ }).click()
  await map(page).getByRole('region', { name: 'Forgotten' }).getByRole('button', { name: 'Review the forgotten task' }).click()
  await expect(reviewField(page, 'review-popup')).toHaveValue('no due and no followup and planned none and stale')
  await expect(popupRows(page)).toHaveCount(1)
  await expect(reviewField(page, 'rv')).toHaveValue('')
})

test('a hidden status leaves the map and its review: `not !Parked`', async ({ page }) => {
  await wsCell(page, 'k1').hover({ position: { x: 40, y: 40 } })
  await wsCell(page, 'k1').getByRole('button', { name: 'Cell options' }).click()
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: /^Hide statuses/ }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Parked' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const slipping = map(page).getByRole('region', { name: 'Slipping' })
  await expect(slipping.getByRole('listitem')).toHaveCount(3)
  await slipping.getByRole('button', { name: 'Review the 3 slipping tasks' }).click()
  await expect(reviewField(page, 'review-popup')).toHaveValue('(due soon or followup soon) and stale and not !Parked')
  await expect(popupRows(page)).toHaveCount(3)
})
