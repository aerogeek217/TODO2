import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedTaskList } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'

/**
 * Every modal blurs the page behind it with one strength (`--backdrop-blur`);
 * a dialog stacked on another adds no second blur, and non-modal popovers
 * never blur.
 */

/** Each modal backdrop's computed `backdrop-filter`, in page order. */
function backdropFilters(page: Page): Promise<string[]> {
  return page.locator('[data-modal-backdrop]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backdropFilter))
}

async function blurToken(page: Page): Promise<string> {
  const px = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--backdrop-blur').trim())
  expect(px).toMatch(/^\d+px$/)
  return `blur(${px})`
}

test('Settings blurs the page; an editor stacked on it adds no second blur', async ({ page }) => {
  await seedTaskList(page, { people: ['Alice'], tasks: [{ title: 'Alpha', people: ['Alice'] }] })
  const blur = await blurToken(page)
  const settings = await openSettings(page, 'People, statuses & tags')
  await expect.poll(() => backdropFilters(page)).toEqual([blur])

  await settings.getByRole('button', { name: 'Manage people…' }).click()
  await expect(page.getByRole('dialog', { name: 'People' })).toBeVisible()
  await expect.poll(() => backdropFilters(page)).toEqual([blur, 'none'])
})

test('the task editor blurs the page; its delete confirm adds no second blur', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'Alpha' }] })
  const blur = await blurToken(page)
  await taskRowByTitle(page, 'Alpha').locator('[data-task-title]').dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect.poll(() => backdropFilters(page)).toEqual([blur])

  await editor.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(2)
  await expect.poll(() => backdropFilters(page)).toEqual([blur, 'none'])
})

test('Quick Add and the command palette blur with the same strength', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'Alpha' }] })
  const blur = await blurToken(page)
  await page.getByRole('button', { name: 'New task' }).click()
  await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
  await expect.poll(() => backdropFilters(page)).toEqual([blur])
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-modal-backdrop]')).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder(/Search tasks, commands/)).toBeFocused()
  await expect.poll(() => backdropFilters(page)).toEqual([blur])
})
