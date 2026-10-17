import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * Double-clicking a task row opens the editor without selecting the row's
 * text (a word selection brings up the browser's text menu, e.g. Edge's
 * mini menu). A double-click inside a text field still selects the word.
 * Text selection is real-browser behaviour — JSDOM doesn't do it.
 */

const selectedText = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? '')
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })

test.describe('desktop row', () => {
  test('double-clicking the title opens the editor with no text selected', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'Quarterly planning notes' }] })
    await taskRowByTitle(page, 'Quarterly planning notes').locator('span[title="Quarterly planning notes"]').dblclick()
    await expect(editor(page)).toBeVisible()
    expect(await selectedText(page)).toBe('')
  })

  test('double-clicking the row outside the title selects no text either', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'Quarterly planning notes' }] })
    const row = taskRowByTitle(page, 'Quarterly planning notes')
    const title = await row.locator('span[title="Quarterly planning notes"]').boundingBox()
    if (!title) throw new Error('no title box')
    // Just past the end of the title text, still on the row.
    await page.mouse.dblclick(title.x + title.width + 4, title.y + title.height / 2)
    await expect(editor(page)).toBeVisible()
    expect(await selectedText(page)).toBe('')
  })

  test('a double-click in the inline title field still selects a word', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'Quarterly planning notes' }] })
    const row = taskRowByTitle(page, 'Quarterly planning notes')
    const id = await row.locator('[data-todo-id]').first().getAttribute('data-todo-id')
    const title = row.locator('span[title="Quarterly planning notes"]')
    // A click selects the row; a later click on the selected row's title edits it inline.
    await title.click()
    await expect(row).toHaveAttribute('data-selected', 'true')
    await title.click()
    const input = page.locator(`[data-todo-id="${id}"] input:not([type="checkbox"])`).first()
    await expect(input).toBeFocused()
    await input.dblclick({ position: { x: 12, y: 8 } })
    const selected = await input.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0))
    expect(selected.trim()).toBe('Quarterly')
  })
})

test.describe('phone row', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('double-clicking the title selects no text', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'Quarterly planning notes' }] })
    const title = page.locator('[data-todo-id]').filter({ hasText: 'Quarterly planning notes' }).getByText('Quarterly planning notes')
    await title.dblclick()
    expect(await selectedText(page)).toBe('')
  })
})
