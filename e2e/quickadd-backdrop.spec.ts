import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { box } from './fixtures/geometry'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'

/**
 * Quick Add sits on the command palette's backdrop (dimmed, blurred). A click
 * on the backdrop closes the bar and reaches nothing underneath — not a task
 * row, not its checkbox. The `@` popup, its person menu and the editor that
 * menu opens still stack above the bar. Hit-testing and stacking need a real
 * browser.
 */

const SEED = {
  people: [{ name: 'Anna', initials: 'AN' }],
  tasks: [{ title: 'Plan the offsite' }, { title: 'Call the plumber' }],
}

const bar = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })
const backdrop = (page: Page) => page.getByTestId('quickadd-backdrop')

async function openQuickAdd(page: Page): Promise<Locator> {
  await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
  await page.keyboard.press('Control+Space')
  const input = bar(page).getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return input
}

/** Whether the middle of `locator` is what the page shows on top there. */
async function isOnTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!top && el.contains(top)
  })
}

test('the backdrop dims and blurs the app like the command palette', async ({ page }) => {
  await seedTaskList(page, SEED)
  await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
  await page.keyboard.press('Control+k')
  const paletteBackdrop = page.locator('[data-dialog-backdrop]')
  await expect(paletteBackdrop).toBeVisible()
  const paletteLook = await paletteBackdrop.evaluate((el) => {
    const s = getComputedStyle(el)
    return { background: s.backgroundColor, filter: s.backdropFilter }
  })
  await page.keyboard.press('Escape')
  await expect(paletteBackdrop).toHaveCount(0)

  await openQuickAdd(page)
  const look = await backdrop(page).evaluate((el) => {
    const s = getComputedStyle(el)
    return { background: s.backgroundColor, filter: s.backdropFilter }
  })
  expect(look).toEqual(paletteLook)
  const blur = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--backdrop-blur').trim())
  expect(look.filter).toBe(`blur(${blur})`)
  // It covers the page: the rows under it aren't what the page shows on top.
  expect(await isOnTop(taskRowByTitle(page, 'Plan the offsite'))).toBe(false)
})

test('a click on the backdrop closes the bar and does not reach the task row under it', async ({ page }) => {
  await seedTaskList(page, SEED)
  const row = taskRowByTitle(page, 'Plan the offsite')
  const check = row.getByRole('checkbox', { name: 'Mark complete' })
  await expect(check).toBeVisible()
  const c = await box(check)
  const t = await box(row.getByText('Plan the offsite'))

  const input = await openQuickAdd(page)
  await page.keyboard.type('Draft')
  // Neither point is under the bar itself.
  const b = await box(bar(page))
  for (const p of [{ x: c.x + c.width / 2, y: c.y + c.height / 2 }, { x: t.x + 4, y: t.y + t.height / 2 }]) {
    expect(p.x < b.x || p.x > b.x + b.width || p.y < b.y || p.y > b.y + b.height).toBe(true)
  }

  // A press inside the field that ends on the backdrop (a text drag) keeps the bar.
  const f = await box(input)
  await page.mouse.move(f.x + 10, f.y + f.height / 2)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(bar(page)).toBeVisible()

  // The checkbox's spot: the bar closes, the task stays open.
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2)
  await expect(bar(page)).toHaveCount(0)
  await expect(check).not.toBeChecked()
  const todos = await readStore<{ title: string; isCompleted: boolean }>(page, 'todos')
  expect(todos.find((x) => x.title === 'Plan the offsite')?.isCompleted).toBe(false)
  expect(todos.map((x) => x.title).sort()).toEqual(['Call the plumber', 'Plan the offsite'])

  // The title's spot: the bar closes, the row is neither selected nor opened.
  await openQuickAdd(page)
  await page.mouse.click(t.x + 4, t.y + t.height / 2)
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // With the bar gone, the same click reaches the row again (the task completes).
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2)
  await expect.poll(async () => (await readStore<{ title: string; isCompleted: boolean }>(page, 'todos'))
    .find((x) => x.title === 'Plan the offsite')?.isCompleted).toBe(true)
})

test('the @ popup’s person menu and its Edit… still stack above the bar and its backdrop', async ({ page }) => {
  await seedTaskList(page, SEED)
  const input = await openQuickAdd(page)
  await page.keyboard.type('Call @an')
  const popup = page.locator('[data-nlp-popup]')
  const anna = popup.getByRole('option', { name: '@Anna' })
  await expect(anna).toBeVisible()
  expect(await isOnTop(anna)).toBe(true)

  await anna.click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '@Anna' })
  await expect(menu).toBeVisible()
  expect(await isOnTop(menu)).toBe(true)

  await menu.getByRole('menuitem', { name: 'Edit…' }).click()
  const editor = page.getByRole('dialog', { name: 'People', exact: true })
  const name = editor.getByPlaceholder('Name')
  await expect(name).toHaveValue('Anna')
  expect(await isOnTop(name)).toBe(true)
  await expect(bar(page)).toBeVisible()

  await editor.getByRole('button', { name: '×' }).first().click()
  await expect(editor).toHaveCount(0)
  await expect(bar(page)).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Call @an')
})
