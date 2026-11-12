import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { expectLayoutStep, seedWorkspace, wsCell, type WorkspaceSeed, wsRow } from './fixtures/workspace'

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
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'map', kind: 'neglect', neglect: { colourBy: { tags: ['Project: Alpha', 'Project: Beta'] } } }] })] }],
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
  await page.locator('header').getByRole('textbox', { name: 'Filter tasks' }).fill('the')
  await expect(dots(page)).toHaveCount(11)
  await page.locator('header').getByRole('textbox', { name: 'Filter tasks' }).fill('report')
  await expect(dots(page)).toHaveCount(1)
  await expect(dots(page, 'slipping')).toHaveCount(1)
  await expect(slippingList(page).getByRole('listitem')).toHaveText([/Ship the quarterly report/])
  // Hiding every task says so; its button (a click on the plot, not a lasso) clears the filter.
  await page.locator('header').getByRole('textbox', { name: 'Filter tasks' }).fill('nothing like this')
  const note = map(page).getByRole('status')
  await expect(note).toContainText('All 12 open tasks are hidden by the screen filter.')
  await note.getByRole('button').click()
  await expect(dots(page)).toHaveCount(12)
})

/** Every dot's and every name's box in the map, in viewport px. */
async function labelGeometry(page: Page) {
  return map(page).evaluate((root) => {
    const rect = (el: Element) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }
    return {
      dots: [...root.querySelectorAll('[data-neglect-dot]')].map((d) => ({ id: d.getAttribute('data-todo-id'), ...rect(d) })),
      labels: [...root.querySelectorAll('[data-neglect-label]')].map((l) => ({ id: l.getAttribute('data-neglect-label'), text: l.textContent ?? '', ...rect(l) })),
      fields: [...root.querySelectorAll('[data-neglect-chart] [role="group"]')].map(rect),
    }
  })
}

type Box = { l: number; t: number; r: number; b: number }
/** Two boxes overlap by more than half a px each way. */
const overlaps = (a: Box, b: Box) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5

test('task names stand beside their dots where they fit: none over a dot or another name; a narrow map names no more', async ({ page }) => {
  await expect(map(page).locator('[data-neglect-label]').first()).toBeVisible()
  const wide = await labelGeometry(page)
  // Twelve open tasks on a wide map: every one is named, by its own title.
  expect(wide.labels.map((l) => l.text).sort()).toEqual(NEGLECT_SEED.tasks!.filter((t) => t.completedInDays == null).map((t) => t.title).sort())
  for (const title of SLIPPING) expect(wide.labels.map((l) => l.text), title).toContain(title)
  const check = (g: typeof wide) => {
    for (const label of g.labels) {
      // On its own dot's line, beside it; over no dot and no other name; inside the plot or the strip.
      const own = g.dots.find((d) => d.id === label.id)!
      const mid = (label.t + label.b) / 2
      expect(Math.abs(mid - (own.t + own.b) / 2), label.text).toBeLessThanOrEqual(1)
      expect(label.l >= own.r || label.r <= own.l, label.text).toBe(true)
      for (const d of g.dots) expect(overlaps(label, d), `${label.text} over a dot`).toBe(false)
      for (const other of g.labels) if (other !== label) expect(overlaps(label, other), `${label.text} over ${other.text}`).toBe(false)
      expect(g.fields.some((f) => label.l >= f.l - 1 && label.r <= f.r + 1), `${label.text} inside its field`).toBe(true)
    }
  }
  check(wide)
  // A name takes no press: a click on it reaches the plot (nothing opens), its dot still opens the task.
  const first = map(page).locator('[data-neglect-label]').first()
  expect(await first.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none')
  if (process.env.NEGLECT_SHOTS) await map(page).screenshot({ path: `${process.env.NEGLECT_SHOTS}/neglect-names-wide.png` })

  // Narrower: the names still keep clear of everything, and there are no more of them.
  await page.setViewportSize({ width: 760, height: 900 })
  await expect.poll(async () => (await box(map(page))).width).toBeLessThan(760)
  await expect.poll(async () => { const g = await labelGeometry(page); return g.labels.every((l) => g.fields.some((f) => l.r <= f.r + 1)) }).toBe(true)
  const narrow = await labelGeometry(page)
  check(narrow)
  expect(narrow.labels.length).toBeLessThanOrEqual(wide.labels.length)
  if (process.env.NEGLECT_SHOTS) await map(page).screenshot({ path: `${process.env.NEGLECT_SHOTS}/neglect-names-narrow.png` })
})

test('a zone’s word opens its tasks as a list; under 900px the widget has no Slipping list and its plot fills it', async ({ page }) => {
  const taskDialog = page.locator('[data-task-dialog]')
  // Wide: the list beside the plot, the dots numbered; the words carry their counts.
  await expect(slippingList(page)).toBeVisible()
  await expect(dot(page, 'Ship the quarterly report')).toHaveText('2')
  const word = (zone: string) => map(page).locator(`[data-neglect-zone="${zone}"]`)
  await expect(word('slipping')).toHaveText('Slipping 4')
  await expect(word('forgotten')).toHaveText('Forgotten · 1')
  await word('inHand').click()
  await expect(taskDialog.getByRole('heading')).toHaveText('In hand')
  await expect(taskDialog.locator('[data-todo-id]')).toHaveCount(await dots(page, 'inHand').count())
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // Narrow: no list (and no numbers on the dots); the plot takes the widget's width and height.
  await page.setViewportSize({ width: 760, height: 700 })
  await expect(slippingList(page)).toHaveCount(0)
  await expect(dot(page, 'Ship the quarterly report')).toHaveText('')
  const [m, plot] = [await box(map(page)), await box(map(page).getByRole('group', { name: /^Neglect map/ }))]
  expect(plot.width).toBeGreaterThan(m.width - 100)
  expect(plot.height).toBeGreaterThan(m.height - 110)
  // Its Slipping tasks: the corner's word.
  await word('slipping').click()
  await expect(taskDialog.getByRole('heading')).toHaveText('Slipping')
  await expect(taskDialog.locator('[data-todo-id]')).toHaveCount(4)
  await page.keyboard.press('Escape')
  // A word takes the press itself: no lasso starts on it, and the dots under it stay clickable.
  await expect(map(page).getByTestId('neglect-lasso')).toHaveCount(0)
  if (process.env.NEGLECT_SHOTS) await map(page).screenshot({ path: `${process.env.NEGLECT_SHOTS}/neglect-no-list.png` })
})

test('the ⋯ menu sets Colour by and Untouched after', async ({ page }) => {
  // Alone in its cell: its top line (its name, Slipping N) stands for the tab (D26 AA1).
  const tab = wsCell(page, 'k1').locator('[data-ws-tab]').getByTestId('top-line-name')
  await expect(tab).toHaveText('Neglect map')
  await tab.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cell options' })
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
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: /^Untouched after/ }).click()
  await page.getByRole('menuitemradio', { name: '30 days' }).click()
  await expect(dots(page, 'slipping')).toHaveCount(2)
  await expect(slippingList(page).getByRole('listitem')).toHaveText([/Clean up the backlog/, /Renew the vendor contract/])
  // Layout config: saved at once, an undo step.
  await expectLayoutStep(page, 'Changed “Neglect map”')
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
