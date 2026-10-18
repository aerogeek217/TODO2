import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList, seedWorkspace } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'
import { readStore } from './fixtures/db'

/**
 * Notes → tasks in a real browser: the toolbar's Convert (preview dialog,
 * draft editor stacked on it, remove / keep prompt) and Alt+T (the task
 * popup). Real-browser because it hands focus between the editor and
 * stacked dialogs, keeps the editor's selection when the button is
 * pressed, and its Esc must close only the top layer.
 */

const NOTES_LAYOUT = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] }] }] }],
  people: [{ name: 'Ben Ortiz', initials: 'BO' }],
  tags: ['planning'],
}

const NOTE = [
  '# Weekly sync',
  '- Draft homepage copy #planning',
  '- [ ] Ask for analytics access @Ben /urgent',
  'Random thought: maybe switch CDN?',
  '- Book venue for team dinner /important',
  '- [x] Send recap email',
].join('\n')

function storedTodos(page: Page): Promise<Array<{ title: string; urgent?: boolean; important?: boolean }>> {
  return readStore(page, 'todos')
}

async function noteLines(editor: Locator): Promise<string[]> {
  return await editor.locator('.cm-line').allTextContents()
}

/** Opens the Notes widget and replaces the note with `text`. */
async function writeNote(page: Page, text: string): Promise<Locator> {
  await seedWorkspace(page, NOTES_LAYOUT)
  const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
  await editor.click()
  await page.keyboard.insertText(text)
  await expect(editor.locator('.cm-line')).toHaveCount(text.split('\n').length)
  return editor
}

test.describe('notes → tasks', () => {
  test('preview → edit a draft → create → remove the converted lines', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    const convert = page.getByRole('button', { name: 'Convert 3 bullet lines to tasks' })
    await convert.hover()
    await expect(editor.locator('.cm-convert-scope')).toHaveCount(3)
    await convert.click()

    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview).toBeVisible()
    await expect(preview.getByText('3 drafts')).toBeVisible()
    await expect(preview.getByText(/From the note "Weekly sync"/)).toBeVisible()
    const rows = preview.getByRole('listitem')
    await expect(rows).toHaveCount(3)
    // The first row has focus.
    await expect(rows.first()).toBeFocused()

    // Edit the second draft in the draft editor stacked on the preview.
    await rows.nth(1).click()
    const title = page.getByRole('textbox', { name: /^New task…/ })
    await expect(title).toHaveValue('Ask for analytics access')
    await expect(page.getByText('Nothing is saved until you create the tasks')).toBeVisible()
    await expect(page.getByLabel('Last follow-up')).toHaveCount(0)
    await title.fill('Ask for analytics access today')
    // Esc in the title only leaves the field; a second Esc closes the editor, not the preview.
    await title.press('Escape')
    await expect(title).toBeVisible()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(title).toBeHidden()
    await expect(preview).toBeVisible()
    const edited = preview.getByRole('listitem', { name: 'Ask for analytics access today' })
    await expect(edited.getByText('edited')).toBeVisible()
    await expect(edited).toBeFocused()

    // Remove the first draft with Del, then create with Ctrl+Enter.
    await rows.first().focus()
    await page.keyboard.press('Delete')
    await expect(rows).toHaveCount(2)
    await expect(preview.getByText('1 line left out')).toBeVisible()
    expect(await storedTodos(page)).toEqual([])
    await page.keyboard.press('Control+Enter')

    const prompt = page.getByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    await expect(prompt).toBeVisible()
    await expect(page.getByText('Created 2 tasks')).toBeVisible()
    const todos = await storedTodos(page)
    expect(todos.map((t) => t.title).sort()).toEqual(['Ask for analytics access today', 'Book venue for team dinner'])
    expect(todos.find((t) => t.title.startsWith('Ask'))?.urgent).toBe(true)
    expect(todos.find((t) => t.title.startsWith('Book'))?.important).toBe(true)

    await prompt.getByRole('button', { name: 'Remove 2 lines' }).click()
    await expect(prompt).toBeHidden()
    expect(await noteLines(editor)).toEqual([
      '# Weekly sync',
      '- Draft homepage copy #planning',
      'Random thought: maybe switch CDN?',
      '- [x] Send recap email',
    ])
    // One Ctrl+Z in the note brings the lines back; the tasks stay.
    await expect(editor).toBeFocused()
    await page.keyboard.press('Control+z')
    expect(await noteLines(editor)).toEqual(NOTE.split('\n'))
    expect(await storedTodos(page)).toHaveLength(2)
  })

  test('a selection scopes the convert; Keep (Esc) marks the lines ✓', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    // Select from inside line 3 to inside line 5 (the plain line between is skipped).
    await editor.locator('.cm-line').nth(2).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    const convert = page.getByRole('button', { name: 'Convert 2 selected lines to tasks' })
    await expect(convert).toBeVisible()
    await convert.click()
    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview.getByText(/From your selection in "Weekly sync"/)).toBeVisible()
    await expect(preview.getByRole('listitem')).toHaveCount(2)
    await preview.getByRole('button', { name: 'Create 2 tasks' }).click()
    const prompt = page.getByRole('dialog', { name: 'Remove 2 converted lines from the note?' })
    await expect(prompt).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(prompt).toBeHidden()
    expect(await noteLines(editor)).toEqual([
      '# Weekly sync',
      '- Draft homepage copy #planning',
      '✓ Ask for analytics access',
      'Random thought: maybe switch CDN?',
      '✓ Book venue for team dinner',
      '- [x] Send recap email',
    ])
  })

  test('Esc in the preview cancels: nothing created, the note unchanged', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    await page.getByRole('button', { name: /^Convert 3/ }).click()
    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    expect(await storedTodos(page)).toEqual([])
    expect(await noteLines(editor)).toEqual(NOTE.split('\n'))
    await expect(editor).toBeFocused()
  })

  test('Alt+T opens the task popup; Cancel leaves the note; Create marks the line', async ({ page }) => {
    const editor = await writeNote(page, NOTE)
    await editor.locator('.cm-line').nth(4).click()
    await page.keyboard.press('Alt+t')
    const title = page.getByRole('textbox', { name: /^New task…/ })
    await expect(title).toHaveValue('Book venue for team dinner')
    await expect(title).toBeFocused()
    await expect(page.getByRole('button', { name: /Important/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(title).toBeHidden()
    expect(await storedTodos(page)).toEqual([])
    expect(await noteLines(editor)).toEqual(NOTE.split('\n'))

    await editor.locator('.cm-line').nth(4).click()
    await page.keyboard.press('Alt+t')
    await expect(title).toHaveValue('Book venue for team dinner')
    await page.keyboard.press('Enter')
    await expect(title).toBeHidden()
    await expect(editor.locator('.cm-line').nth(4)).toHaveText('✓ Book venue for team dinner')
    expect((await storedTodos(page)).map((t) => t.title)).toEqual(['Book venue for team dinner'])
  })

  test('row notes popover: Convert stays inside it; Esc closes the preview, not the popover', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'alpha', notes: '- one\n- two' }] })
    await taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Edit progress and notes' }).click()
    const popover = page.getByRole('dialog', { name: 'Progress and notes' })
    const convert = popover.getByRole('button', { name: 'Convert 2 bullet lines to tasks' })
    await expect(convert).toBeVisible()
    // The popover is narrower than 360px: glyph + count only.
    await expect(convert.getByText('Convert', { exact: true })).toBeHidden()
    await convert.click()
    const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
    await expect(preview).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(popover).toBeVisible()

    // Through to the prompt: clicking in the dialogs never closes the popover.
    await convert.press('Enter')
    await preview.getByRole('button', { name: 'Create 2 tasks' }).click()
    await page.getByRole('dialog', { name: /Remove 2 converted lines/ }).getByRole('button', { name: 'Remove 2 lines' }).click()
    await expect(popover).toBeVisible()
    await expect(popover.locator('.cm-content')).toHaveText('')
    await expect(taskRowByTitle(page, 'one')).toBeVisible()
  })

  test('task editor notes: Alt+T stacks a create popup on the editor; Esc closes only it', async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'alpha', notes: 'Call vendor /urgent' }] })
    await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
    const editTitle = page.getByRole('textbox', { name: 'Task title' })
    await expect(editTitle).toBeVisible()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Alt+t')
    const createTitle = page.getByRole('textbox', { name: /^New task…/ })
    await expect(createTitle).toHaveValue('Call vendor')
    // Nothing of the editor below covers the popup.
    const box = await createTitle.boundingBox()
    if (!box) throw new Error('no title box')
    const onTop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('placeholder') ?? '',
      { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(onTop).toMatch(/^New task…/)
    await createTitle.press('Escape') // leaves the field
    await page.keyboard.press('Escape') // closes the popup
    await expect(createTitle).toBeHidden()
    await expect(editTitle).toBeVisible()
    expect((await storedTodos(page)).map((t) => t.title)).toEqual(['alpha'])

    await page.locator('.cm-content').click()
    await page.keyboard.press('Alt+t')
    await page.keyboard.press('Enter')
    await expect(createTitle).toBeHidden()
    await expect(editTitle).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText('✓ Call vendor')
    expect((await storedTodos(page)).map((t) => t.title).sort()).toEqual(['Call vendor', 'alpha'])
  })
})
