import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Project pulse's rules (G5) in a real browser: Edit project pulse… opens
 * the editor under the widget's title; Stale given its own filter — typed
 * as an expression — and a name changes the card's count and its words;
 * the layout is then unsaved.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const ATLAS = 'Project: Atlas'

const SEED: WorkspaceSeed = {
  tags: [{ name: ATLAS, color: '#4f8cff' }],
  tasks: [
    // Followed up a month ago, touched today: not stale by Settings (30 days), stale by the rule.
    { title: 'Chase the vendor', lastFollowupInDays: -30, tags: [ATLAS] },
    // Never followed up and untouched for 40 days: stale both ways.
    { title: 'Renew the domain', modifiedInDays: -40, tags: [ATLAS] },
    // Followed up five days ago: stale neither way.
    { title: 'Ship the beta', lastFollowupInDays: -5, dueInDays: -1, tags: [ATLAS] },
    // Never followed up, touched today: stale by the rule only.
    { title: 'Book the venue', tags: [ATLAS] },
  ],
  layouts: [{ name: 'Brief', columns: [{ id: 'c1', rows: [
    { cells: [{ id: 'kp', tabs: [{ id: 'pulse', kind: 'pulse', tagNames: [ATLAS] }] }] },
    { cells: [{ id: 'kn', tabs: [{ id: 'notes', kind: 'notes' }] }] },
  ] }] }],
}

const pulse = (page: Page) => page.locator('[data-glance="pulse"]')
const card = (page: Page) => pulse(page).locator('[data-pulse-card]').first()
const editor = (page: Page) => page.locator('[data-pulse-editor]')

test('Edit project pulse…: Stale given a filter and a name changes the card’s count; the layout is unsaved', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(card(page).locator('[data-pulse-count="stale"]')).toHaveText('1 stale')
  await expect(card(page).locator('[data-pulse-count="late"]')).toHaveText('1 late (25%)')

  const head = pulse(page).locator('[data-pulse-head]')
  await head.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Edit project pulse…' }).click()
  await expect(editor(page)).toBeVisible()
  // Under the widget's title.
  const hb = (await head.boundingBox())!
  const eb = (await editor(page).boundingBox())!
  expect(eb.y).toBeGreaterThan(hb.y + hb.height - 1)

  const stale = editor(page).locator('[data-pulse-rule="stale"]')
  await expect(stale.getByTestId('pulse-stale-default')).toHaveText('Follows Settings: untouched 30 days')
  await stale.getByRole('button', { name: 'Use a filter' }).click()
  // Its first filter keeps what Settings' threshold does.
  await expect(card(page).locator('[data-pulse-count="stale"]')).toHaveText('1 stale')
  await stale.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = stale.getByRole('textbox', { name: 'Filter expression' })
  await field.fill('followed by 21 days ago or never followed')
  await field.press('Enter')
  await expect(card(page).locator('[data-pulse-count="stale"]')).toHaveText('3 stale')
  await stale.getByRole('textbox', { name: 'Stale name' }).fill('quiet')
  await expect(card(page).locator('[data-pulse-count="stale"]')).toHaveText('3 quiet')

  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
})
