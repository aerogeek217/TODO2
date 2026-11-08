import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A list's switch for the top bar's lens: while the lens hides tasks in the
 * list, its filter line ends with the glasses and `−N`, then the list's
 * count, then group · sort — the count no longer on the tab. A click turns
 * the lens off for this list alone (slashed glasses, every task back),
 * saved at once: it outlasts a reload and never makes the list unsaved.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Marcus Chen'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Write the review', people: ['Aisha Rahman'] },
    { title: 'Plan the offsite', people: ['Marcus Chen'] },
    { title: 'Call the vendor', people: ['Aisha Rahman'] },
  ],
  lenses: [{ id: 'lens-aisha', name: 'Aisha', predicate: { personIds: [1] } }],
  layouts: [
    { name: 'Default', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
  ],
}

const line = (page: Page) => page.getByTestId('list-filter-row')
const lensSwitch = (page: Page) => line(page).getByTestId('list-lens-switch')
const count = (page: Page) => line(page).getByTestId('list-count')
const rows = (page: Page) => page.locator('[data-todo-id]')

async function pickLens(page: Page, name: string) {
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  await expect(control).toHaveAccessibleName(`Lens: ${name}`)
}

test('the lens’s switch sits just left of the count at the line’s end; off for this list it stays off after a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(rows(page)).toHaveCount(3)
  // No lens: the count on the line, nothing on the tab, no switch.
  await expect(count(page)).toHaveText('3')
  await expect(lensSwitch(page)).toHaveCount(0)
  await expect(page.locator('[data-ws-tab="t1"]')).not.toContainText('3')

  await pickLens(page, 'Aisha')
  await expect(rows(page)).toHaveCount(2)
  await expect(lensSwitch(page)).toHaveText('−1')
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(count(page)).toHaveText('2 of 3')

  // Right to left: group · sort, the count, the switch — the switch's right edge just before the count.
  const s = await box(lensSwitch(page))
  const c = await box(count(page))
  const summary = await box(line(page).getByTestId('list-summary'))
  expect(s.x + s.width).toBeLessThanOrEqual(c.x + 0.5)
  expect(c.x - (s.x + s.width)).toBeLessThan(8)
  expect(c.x + c.width).toBeLessThanOrEqual(summary.x + 0.5)
  expect(Math.abs((s.y + s.height / 2) - (c.y + c.height / 2))).toBeLessThan(2)

  await lensSwitch(page).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(lensSwitch(page)).not.toContainText('−')
  await expect(count(page)).toHaveText('3')
  // Saved at once, not a list edit: no Revert · Save.
  await expect(line(page).getByRole('button', { name: /^Save/ })).toHaveCount(0)

  await page.reload()
  await expect(rows(page)).toHaveCount(3)
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await lensSwitch(page).click()
  await expect(rows(page)).toHaveCount(2)
})

test('with the filter line hidden, the tab shows the lens beside its count, and its menu turns the lens off here', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', showFilterLine: false }] })
  await pickLens(page, 'Aisha')
  const t1 = page.locator('[data-ws-tab="t1"]')
  await expect(t1.locator('[data-tab-lens]')).toHaveAccessibleName('“Aisha” hides 1 here')
  await expect(t1).toContainText('2 of 3')
  await t1.click({ button: 'right' })
  await page.getByRole('menuitemcheckbox', { name: 'Apply lens “Aisha” here' }).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(t1.locator('[data-tab-lens]')).toHaveAccessibleName('Ignores the lens “Aisha”')
})
