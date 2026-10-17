import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The ways into the email check-in dialog, in a real browser: the person
 * task dialog's footer, the palette's per-person commands, the envelope and
 * the right-click / Shift+F10 menu on a People group header (placement near
 * the window's edges included), and the top-bar People filter's footer.
 * Each opens the dialog with exactly the right people ticked.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const PEOPLE: WorkspaceSeed['people'] = [
  { name: 'Ada Lovelace', email: 'ada@example.com' },
  { name: 'Bob Stone', email: 'bob@example.com' },
  'Cy Young',
]

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Overdue report', people: ['Ada Lovelace'], dueInDays: -2 },
  { title: 'Review plan', people: ['Ada Lovelace', 'Bob Stone'], dueInDays: 4 },
  { title: 'Bob only', people: ['Bob Stone'] },
  { title: 'Cy only', people: ['Cy Young'] },
  { title: 'Nobody’s', people: [] },
]

/** A People-grouped list (`t1`) beside a dashboard (`dash`), the list in the right-hand column. */
const SEED: WorkspaceSeed = {
  people: PEOPLE,
  listDefinitions: [{ name: 'Team', grouping: 'people' }],
  tasks: TASKS,
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard' }] }] },
      { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
    ],
  }],
}

const checkinDialog = (page: Page) => page.getByRole('dialog', { name: 'Email task check-ins' })
const checkinRow = (page: Page, name: string) => checkinDialog(page).locator('[data-checkin-row]').filter({ hasText: name })

/** The check-in dialog is open with exactly `names` ticked (people with an email). */
async function expectTicked(page: Page, names: string[]) {
  await expect(checkinDialog(page)).toBeVisible()
  const rows = checkinDialog(page).locator('[data-checkin-row]')
  const ticked: string[] = []
  for (const row of await rows.all()) {
    if (await row.getByRole('checkbox').isChecked()) ticked.push((await row.locator('label').textContent()) ?? '')
  }
  expect(ticked.map((t) => names.find((n) => t.startsWith(n)) ?? t)).toEqual(names)
}

const groupHeader = (page: Page, name: string): Locator =>
  wsListWidget(page, 't1').locator('[data-person-group]').filter({ hasText: name })
const envelope = (page: Page, name: string) => groupHeader(page, name).getByRole('button', { name: `Email check-in to ${name}` })
const opacity = (el: Locator) => el.evaluate((e) => Number(getComputedStyle(e).opacity))

test('A: the person task dialog (task-row chip, dashboard People row) offers Email check-in', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const taskDialog = page.locator('[data-task-dialog]')

  // A task row's person chip.
  const row = wsListWidget(page, 't1').locator('[data-list-group="person-1"] [data-todo-id]').filter({ hasText: 'Review plan' })
  await row.locator('[data-person-avatar]').first().click({ button: 'right' })
  await expect(taskDialog.getByRole('heading')).toHaveText('Bob Stone')
  const footer = taskDialog.locator('[class*="footer"]')
  await expect(footer.getByRole('button').nth(1)).toHaveText('Email check-in')
  await footer.getByRole('button', { name: 'Email check-in' }).click()
  await expectTicked(page, ['Bob Stone'])
  // It opened over the task dialog, which is still there when it closes.
  await checkinDialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(checkinDialog(page)).toHaveCount(0)
  await expect(taskDialog).toBeVisible()
  await expect(footer.getByRole('button', { name: 'Email check-in' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // The dashboard's People row: a person without an email opens with Add email.
  await page.locator('[data-dashboard="dash"] [data-person-row]').filter({ hasText: 'Cy Young' }).click()
  await expect(taskDialog.getByRole('heading')).toHaveText('Cy Young')
  await taskDialog.getByRole('button', { name: 'Email check-in' }).click()
  await expect(checkinDialog(page)).toBeVisible()
  const cy = checkinRow(page, 'Cy Young')
  await expect(checkinDialog(page).locator('[data-checkin-row]').first()).toContainText('Cy Young')
  await expect(cy.getByRole('checkbox')).toBeDisabled()
  await expect(cy.getByRole('button', { name: 'Add email for Cy Young' })).toBeVisible()
})

test('B: the palette lists Email check-in per person with an email and open tasks', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder(/Search tasks, commands/)
  await input.fill('>check-in:')
  const email = page.getByRole('group', { name: 'Email' })
  await expect(email.getByRole('option', { name: /Email check-in: Ada Lovelace/ })).toContainText('2 open tasks')
  await expect(email.getByRole('option', { name: /Email check-in: Bob Stone/ })).toContainText('2 open tasks')
  // Cy has no email address: no command.
  await expect(email.getByRole('option', { name: /Cy Young/ })).toHaveCount(0)
  await email.getByRole('option', { name: /Email check-in: Ada Lovelace/ }).click()
  await expectTicked(page, ['Ada Lovelace'])
  await checkinDialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(checkinDialog(page)).toHaveCount(0)

  // Several words each match on their own: "email bob" puts Bob's command on top, Enter runs it.
  await page.keyboard.press('Control+k')
  await input.pressSequentially('email bob')
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.first()).toContainText('Email check-in: Bob Stone')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expectTicked(page, ['Bob Stone'])
})

test('C: a People group header shows its envelope on hover and on keyboard focus', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const widget = wsListWidget(page, 't1')
  await expect(widget.getByTestId('list-group-name')).toHaveText(['Ada Lovelace', 'Bob Stone', 'Cy Young', 'Unassigned'])
  await expect(widget.locator('[data-list-group="unassigned"]').getByRole('button', { name: /Email check-in/ })).toHaveCount(0)

  // Hidden until the header is hovered.
  await page.mouse.move(5, 5)
  await expect.poll(() => opacity(envelope(page, 'Bob Stone'))).toBe(0)
  await groupHeader(page, 'Bob Stone').hover()
  await expect.poll(() => opacity(envelope(page, 'Bob Stone'))).toBe(1)
  await page.mouse.move(5, 5)
  await expect.poll(() => opacity(envelope(page, 'Bob Stone'))).toBe(0)

  // Keyboard: Tab from the header's collapse button reaches it, and it shows.
  await groupHeader(page, 'Ada Lovelace').getByRole('button', { expanded: true }).focus()
  await page.keyboard.press('Tab')
  await expect(envelope(page, 'Ada Lovelace')).toBeFocused()
  await expect.poll(() => opacity(envelope(page, 'Ada Lovelace'))).toBe(1)
  await page.keyboard.press('Enter')
  await expectTicked(page, ['Ada Lovelace'])
})

test('C: the header menu opens at the pointer or under the header, inside the window, and its items work', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const vw = page.viewportSize()!.width
  const menu = page.getByRole('menu', { name: 'Bob Stone group' })

  // Right-click near the window's right edge: the menu flips left of the pointer.
  const header = groupHeader(page, 'Bob Stone')
  const box = (await header.boundingBox())!
  const at = { x: box.x + box.width - 6, y: box.y + box.height / 2 }
  expect(vw - at.x).toBeLessThan(120)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Email check-in: Bob Stone', 'Show all of Bob Stone’s tasks'])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  const m = (await menu.boundingBox())!
  expect(m.x + m.width).toBeLessThanOrEqual(vw)
  expect(m.x + m.width).toBeLessThanOrEqual(at.x + 1)
  expect(Math.abs(m.y - at.y)).toBeLessThan(8)

  // Show all → the person's task dialog.
  await menu.getByRole('menuitem', { name: 'Show all of Bob Stone’s tasks' }).click()
  const taskDialog = page.locator('[data-task-dialog]')
  await expect(taskDialog.getByRole('heading')).toHaveText('Bob Stone')
  await expect(taskDialog.locator('[data-todo-id]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // Shift+F10 on the focused header: the menu opens under it; Email check-in ticks the person.
  const collapse = header.getByRole('button', { expanded: true })
  await collapse.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  const hb = (await header.boundingBox())!
  const kb = (await menu.boundingBox())!
  expect(kb.y).toBeGreaterThanOrEqual(hb.y + hb.height)
  expect(kb.y - (hb.y + hb.height)).toBeLessThan(12)
  await page.keyboard.press('Enter')
  await expectTicked(page, ['Bob Stone'])
  // Collapse still works from the header.
  await checkinDialog(page).getByRole('button', { name: 'Done' }).click()
  await collapse.click()
  await expect(header.getByRole('button', { expanded: false })).toBeVisible()
})

test('C: near the bottom of the window the header menu opens upward', async ({ page }) => {
  await seedWorkspace(page, SEED)
  // Shrink the window so the last group's header sits near its bottom.
  const header = groupHeader(page, 'Cy Young')
  const before = (await header.boundingBox())!
  await page.setViewportSize({ width: 1440, height: Math.round(before.y + before.height + 30) })
  const box = (await header.boundingBox())!
  const vh = page.viewportSize()!.height
  expect(vh - (box.y + box.height)).toBeLessThan(80)
  await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cy Young group' })
  await expect(menu).toBeVisible()
  const m = (await menu.boundingBox())!
  expect(m.y + m.height).toBeLessThanOrEqual(vh)
  expect(m.y + m.height).toBeLessThanOrEqual(box.y + box.height / 2 + 1)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('D: the top-bar People filter offers Email check-in for the people it is narrowed to', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const peopleButton = page.getByRole('button', { name: /^People filter/ })
  await peopleButton.click()
  // Not narrowed: a hint.
  await expect(page.getByText('Narrow to some people to email them.')).toBeVisible()
  // Pick Ada (the first pick replaces "everyone"), then Bob.
  await page.locator('label').filter({ hasText: '@Ada Lovelace' }).click()
  await expect(page.getByRole('button', { name: 'Email check-in to Ada Lovelace…' })).toBeVisible()
  await page.locator('label').filter({ hasText: '@Bob Stone' }).click()
  const action = page.getByRole('button', { name: 'Email check-in to 2 people…' })
  await expect(action).toBeVisible()
  await action.click()
  await expectTicked(page, ['Ada Lovelace', 'Bob Stone'])
  // The picker closed.
  await expect(page.getByPlaceholder('Search...')).toHaveCount(0)
})
