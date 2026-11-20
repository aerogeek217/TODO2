import { expect, test, type Locator, type Page } from '@playwright/test'
import { emptyPredicate } from '../src/models/filter-predicate'
import { expectLayoutStep, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A Breakdown count column's follow-up age (board V1, option B): `23d`
 * right after the column's count, muted, in the follow-up color past its
 * threshold; the heading's `age` toggle sorts by it (saved at once, kept
 * across a reload); its tooltip names the oldest open task and the median;
 * a click reviews the row's tasks; Edit breakdown turns it off.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const FOLLOWUP = {
  id: 'followup',
  name: 'Follow-up',
  color: '#f5c842',
  filter: { ...emptyPredicate(), dates: { followup: { match: 'range', start: null, end: { kind: 'offset', days: 0 } } } },
  litWhen: 'above',
  litAt: 0,
  age: { yellowAfterDays: 14 },
}

const SEED: WorkspaceSeed = {
  people: ['Sam Lee', 'Marcus Chen', 'Priya Nair', 'Lena Fischer'],
  tasks: [
    { title: 'Sam stalled', people: ['Sam Lee'], lastFollowupInDays: -31 },
    { title: 'Vendor contract renewal', people: ['Marcus Chen'], lastFollowupInDays: -23, followupInDays: -1 },
    { title: 'Marcus recent', people: ['Marcus Chen'], lastFollowupInDays: -9 },
    { title: 'Marcus fresh', people: ['Marcus Chen'], lastFollowupInDays: -2 },
    { title: 'Priya check', people: ['Priya Nair'], lastFollowupInDays: -12 },
    { title: 'Lena today', people: ['Lena Fischer'], lastFollowupInDays: -4 },
    { title: 'Lena long done', people: ['Lena Fischer'], lastFollowupInDays: -50, isCompleted: true },
  ],
  layouts: [{
    name: 'Charts',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'people', kind: 'breakdown', glance: { name: 'People', splitBy: 'people', columns: [FOLLOWUP] } }] })] }],
  }, {
    name: 'Review',
    columns: [{ id: 'r1', rows: [wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] })] }],
  }],
}

const chart = (page: Page) => page.locator('[data-chart="people"]')
const row = (page: Page, name: string): Locator =>
  chart(page).locator('[data-breakdown-row]').filter({ has: page.getByRole('button', { name: new RegExp(`^${name}:`) }) })
const age = (page: Page, name: string) => row(page, name).getByTestId('breakdown-age')
const rowNames = (page: Page) =>
  chart(page).locator('[data-breakdown-row] > [role="cell"]:first-child > button:first-child')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.split(':')[0]))
const ageToggle = (page: Page) => chart(page).locator('[data-sort-key="age:followup"]')

test('the age follows the count in a wider cell: muted, yellow past its threshold, a completed task never counted', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(age(page, 'Sam Lee')).toHaveText('31d')
  await expect(age(page, 'Marcus Chen')).toHaveText('23d')
  await expect(age(page, 'Priya Nair')).toHaveText('12d')
  // Lena's completed task (50 days) doesn't age her row.
  await expect(age(page, 'Lena Fischer')).toHaveText('4d')
  // Past 14 days: the follow-up color; within it: muted.
  await expect(age(page, 'Sam Lee')).toHaveCSS('color', 'rgb(245, 200, 66)')
  await expect(age(page, 'Priya Nair')).not.toHaveCSS('color', 'rgb(245, 200, 66)')
  // Right after the count pill, on its line; the cell 100px (the board's).
  const marcus = row(page, 'Marcus Chen')
  const count = (await marcus.locator('[data-column="followup"]').boundingBox())!
  const ab = (await age(page, 'Marcus Chen').boundingBox())!
  expect(ab.x).toBeGreaterThan(count.x + count.width)
  expect(ab.x - (count.x + count.width)).toBeLessThan(12)
  expect(Math.abs((ab.y + ab.height / 2) - (count.y + count.height / 2))).toBeLessThan(2)
  const head = (await chart(page).locator('[data-age-heading="followup"]').boundingBox())!
  expect(Math.round(head.width)).toBe(100)
  // The heading is the column's name, then the `age` toggle, both on one line inside it.
  const name = (await chart(page).locator('[data-sort-key="followup"]').boundingBox())!
  const toggle = (await ageToggle(page).boundingBox())!
  expect(toggle.x).toBeGreaterThanOrEqual(name.x + name.width - 1)
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(head.x + head.width + 1)
})

test('the age toggle sorts oldest first, then reversed, then back; saved at once and kept across a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const before = await rowNames(page)
  await ageToggle(page).click()
  await expect(ageToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => rowNames(page)).toEqual(['Sam Lee', 'Marcus Chen', 'Priya Nair', 'Lena Fischer'])
  await page.reload()
  await expect.poll(() => rowNames(page)).toEqual(['Sam Lee', 'Marcus Chen', 'Priya Nair', 'Lena Fischer'])
  await ageToggle(page).click()
  await expect.poll(() => rowNames(page)).toEqual(['Lena Fischer', 'Priya Nair', 'Marcus Chen', 'Sam Lee'])
  await ageToggle(page).click()
  await expect(ageToggle(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => rowNames(page)).toEqual(before)
})

test('its tooltip names the oldest open task and the median; a click reviews the row’s tasks', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await age(page, 'Marcus Chen').hover()
  await expect(page.getByRole('tooltip')).toHaveText('Oldest: “Vendor contract renewal” · 23 days since followed up · median 9 days')
  await age(page, 'Marcus Chen').click()
  // No Review widget on this layout: the popup review, with Marcus's three open tasks.
  const queue = page.locator('[data-review-widget="review-popup"] [data-review-row]')
  await expect(page.locator('[data-review-widget="review-popup"]').getByRole('textbox', { name: 'Review filter' })).toHaveValue('@"Marcus Chen"')
  await expect(queue).toHaveCount(3)
})

test('Edit breakdown › Count columns turns it off', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await chart(page).locator('[data-chart-head]').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit breakdown…' }).click()
  const editor = page.locator('[data-chart-editor]')
  const column = editor.locator('[data-column-editor="followup"]')
  const check = column.getByRole('checkbox', { name: 'Days since follow-up after the count' })
  await expect(check).toBeChecked()
  await expect(column.getByRole('spinbutton', { name: 'Follow-up: yellow past (days)' })).toHaveValue('14')
  await check.uncheck()
  await expect(column.getByRole('spinbutton', { name: /yellow past/ })).toHaveCount(0)
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await expectLayoutStep(page)
  await expect(chart(page).getByTestId('breakdown-age')).toHaveCount(0)
  await expect(ageToggle(page)).toHaveCount(0)
})
