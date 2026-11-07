import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { seedWorkspace, wsCell, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Neglect map widget (D25 board H) in a real browser: a task due soon
 * or late and untouched for the threshold lands in the shaded Slipping
 * corner and the Slipping list; a dot opens the editor; a drag on empty
 * plot lassoes dots into the bulk bar; the screen filter narrows the dots;
 * the tab menu's Colour by and Untouched after change what it shows.
 */

const NEGLECT_SEED: WorkspaceSeed = {
  tags: [{ name: 'Project: Alpha', color: '#e0a458' }, { name: 'Project: Beta', color: '#6c9ef8' }, 'home'],
  tasks: [
    { title: 'Ship the quarterly report', dueInDays: -4, modifiedInDays: -26, tags: ['Project: Alpha'], urgent: true },
    { title: 'Renew the vendor contract', dueInDays: 2, modifiedInDays: -30, tags: ['Project: Beta'], followupInDays: -2 },
    { title: 'Clean up the backlog', dueInDays: -10, modifiedInDays: -45, tags: ['Project: Alpha'] },
    { title: 'Call the auditor', dueInDays: 1, modifiedInDays: -18 },
    { title: 'Draft the launch plan', dueInDays: -1, modifiedInDays: -2, tags: ['Project: Beta'] },
    { title: 'Answer the RFP', dueInDays: -6, modifiedInDays: -5, important: true },
    { title: 'Book the offsite', dueInDays: 12, modifiedInDays: -1, tags: ['Project: Alpha'] },
    { title: 'Plan the retro', dueInDays: 5, modifiedInDays: -8 },
    { title: 'Update the wiki', dueInDays: 20, modifiedInDays: -40, tags: ['home'] },
    { title: 'Review the hiring loop', dueInDays: 25, modifiedInDays: -70, tags: ['Project: Beta'] },
    { title: 'Archive old tickets', modifiedInDays: -50 },
    { title: 'Sketch the new logo', modifiedInDays: -3, tags: ['Project: Beta'] },
    { title: 'Finished already', dueInDays: -3, modifiedInDays: -20, completedInDays: -1 },
  ],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'map', kind: 'neglect', neglect: { colourBy: { tags: ['Project: Alpha', 'Project: Beta'] } } }] }] }],
  }],
}

/** Latest first: 10, 4 days late; due in 1, 2 days. */
const SLIPPING = ['Clean up the backlog', 'Ship the quarterly report', 'Call the auditor', 'Renew the vendor contract']

const map = (page: Page) => wsCell(page, 'k1').locator('[data-neglect-map]')
const dots = (page: Page, zone?: string) => map(page).locator(zone ? `[data-neglect-dot="${zone}"]` : '[data-neglect-dot]')
const dot = (page: Page, title: string) => map(page).locator('[data-neglect-dot]').and(page.getByRole('button', { name: new RegExp(`^${title}: `) }))
const slippingList = (page: Page) => map(page).getByRole('region', { name: 'Slipping' })

/** The centre of `locator`'s box. */
async function centre(locator: Locator) {
  const b = await box(locator)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ page }) => {
  await seedWorkspace(page, NEGLECT_SEED)
  await expect(map(page)).toBeVisible()
})

test('a task due soon or late and untouched for 14 days lands in the Slipping corner and list', async ({ page }) => {
  await expect(dots(page)).toHaveCount(12)
  await expect(dots(page, 'slipping')).toHaveCount(4)
  // The list: latest first, numbered, the dots badged to match.
  const rows = slippingList(page).getByRole('listitem')
  await expect(rows).toHaveText(SLIPPING.map((t, i) => new RegExp(`^${i + 1}${t}`)))
  await expect(rows.nth(1)).toContainText('4d late · 26d untouched')
  await expect(dot(page, 'Ship the quarterly report')).toHaveText('2')
  // Every Slipping dot sits in the shaded corner; no other dot does.
  const corner = await box(map(page).getByTestId('neglect-slipping-corner'))
  const inCorner = async (l: Locator) => {
    const c = await centre(l)
    return c.x >= corner.x && c.x <= corner.x + corner.width && c.y >= corner.y && c.y <= corner.y + corner.height
  }
  for (const title of SLIPPING) expect(await inCorner(dot(page, title)), title).toBe(true)
  for (const title of ['Draft the launch plan', 'Answer the RFP', 'Book the offsite', 'Update the wiki']) {
    expect(await inCorner(dot(page, title)), title).toBe(false)
  }
  // Colour by the project tags; a priority flag makes a dot larger, a late follow-up rings it.
  const ship = dot(page, 'Ship the quarterly report')
  await expect(ship).toHaveCSS('background-color', 'rgb(224, 164, 88)')
  await expect(dot(page, 'Renew the vendor contract')).toHaveCSS('background-color', 'rgb(108, 158, 248)')
  expect((await box(ship)).width).toBeGreaterThan((await box(dot(page, 'Call the auditor'))).width)
  await expect(dot(page, 'Renew the vendor contract')).toHaveAttribute('data-followup-late', 'true')
  // No due date: the strip, Forgotten once untouched for the threshold.
  await expect(map(page).getByTestId('neglect-forgotten')).toHaveText('Forgotten · 1')
  await expect(dot(page, 'Archive old tickets')).toHaveAttribute('data-neglect-dot', 'forgotten')
})

test('a dot opens the task’s editor', async ({ page }) => {
  await dot(page, 'Book the offsite').click()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox', { name: 'Task title' })).toHaveValue('Book the offsite')
})

test('a drag on empty plot lassoes the dots into the bulk bar', async ({ page }) => {
  const corner = await box(map(page).getByTestId('neglect-slipping-corner'))
  const from = { x: corner.x + 2, y: corner.y + 2 }
  const to = { x: corner.x + corner.width - 2, y: corner.y + corner.height - 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await expect(map(page).getByTestId('neglect-lasso')).toBeVisible()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await expect(map(page).getByTestId('neglect-lasso')).toHaveCount(0)
  await expect(page.getByText('4 selected')).toBeVisible()
  for (const title of SLIPPING) await expect(dot(page, title)).toHaveAttribute('data-selected', 'true')
  await expect(dot(page, 'Draft the launch plan')).not.toHaveAttribute('data-selected', 'true')
  // A click on empty plot clears it.
  await page.mouse.click(from.x, from.y)
  await expect(page.getByText('4 selected')).toHaveCount(0)
})

test('the screen filter narrows the dots', async ({ page }) => {
  await page.locator('header').getByRole('textbox', { name: 'Search tasks' }).fill('the')
  await expect(dots(page)).toHaveCount(11)
  await page.locator('header').getByRole('textbox', { name: 'Search tasks' }).fill('report')
  await expect(dots(page)).toHaveCount(1)
  await expect(dots(page, 'slipping')).toHaveCount(1)
  await expect(slippingList(page).getByRole('listitem')).toHaveText([/Ship the quarterly report/])
})

test('the tab menu sets Colour by and Untouched after', async ({ page }) => {
  const tab = wsCell(page, 'k1').getByRole('tab', { name: /^Neglect map/ })
  await tab.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Change widget' })
  await menu.getByRole('menuitem', { name: /^Colour by/ }).click()
  await page.getByRole('menuitemradio', { name: 'None' }).click()
  await expect(dot(page, 'Ship the quarterly report')).not.toHaveAttribute('data-coloured', 'true')
  // A tag ticked colours by tags again (the submenu stays open).
  await page.getByRole('menuitemcheckbox', { name: 'home' }).click()
  await expect(dot(page, 'Update the wiki')).toHaveAttribute('data-coloured', 'true')
  await expect(dot(page, 'Ship the quarterly report')).not.toHaveAttribute('data-coloured', 'true')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await tab.click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: /^Untouched after/ }).click()
  await page.getByRole('menuitemradio', { name: '30 days' }).click()
  await expect(dots(page, 'slipping')).toHaveCount(2)
  await expect(slippingList(page).getByRole('listitem')).toHaveText([/Clean up the backlog/, /Renew the vendor contract/])
  // Layout config: the layout is unsaved.
  await expect(page.getByRole('button', { name: /^Save/ }).first()).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the plot scales to the width, the Slipping list under it; a tap opens the task', async ({ page }) => {
    await expect(map(page)).toHaveAttribute('data-layout', 'stacked')
    const plot = await box(map(page).getByRole('group', { name: /^Neglect map/ }))
    const list = await box(slippingList(page))
    expect(list.y).toBeGreaterThan(plot.y + plot.height)
    expect(plot.width).toBeGreaterThan(250)
    await dot(page, 'Call the auditor').tap()
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  })
})
