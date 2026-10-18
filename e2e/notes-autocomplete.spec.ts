import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList, seedWorkspace } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'
import { readStore } from './fixtures/db'

/**
 * The notes editor's `@ # /` popup and token tints, in each place notes are
 * edited: the Notes widget, the task editor's notes and a row's notes
 * popover. Real-browser because the popup is portalled and anchored at the
 * caret from CodeMirror's measured layout, flips near the viewport edge, and
 * its keys must win over the editor's and every host's own (Esc, outside
 * click).
 */

const popup = (page: Page) => page.locator('[data-nlp-popup]')

async function storedNames(page: Page, store: 'people' | 'tags'): Promise<string[]> {
  return (await readStore<{ name: string }>(page, store)).map((r) => r.name)
}

/** The popup's box and the box of the tinted token starting with `token` in `editor`. */
async function boxes(page: Page, editor: Locator, token: string) {
  const tokenBox = await editor.locator('.cm-nlp-tint', { hasText: token }).last().boundingBox()
  const popupBox = await popup(page).boundingBox()
  if (!tokenBox || !popupBox) throw new Error('no token or popup box')
  return { tokenBox, popupBox }
}

/** The text of the editor's line containing `fragment`. */
async function lineWith(editor: Locator, fragment: string): Promise<string> {
  return (await editor.locator('.cm-line', { hasText: fragment }).first().textContent()) ?? ''
}

const NOTES_LAYOUT = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] }] }] }],
  people: ['Anna', { name: 'Dana Kim', initials: 'DK' }],
  tags: ['q4'],
  statuses: ['In progress'],
}

test.describe('notes autocomplete', () => {
  test('Notes widget: anchored at the caret, keys, commands, Esc, create on pick', async ({ page }) => {
    await seedWorkspace(page, NOTES_LAYOUT)
    const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
    await editor.click()

    // `@` opens under the trigger character.
    await page.keyboard.type('- Call @Da')
    await expect(popup(page)).toBeVisible()
    await expect(popup(page).getByRole('option')).toHaveText(['@Dana Kim'])
    const { tokenBox, popupBox } = await boxes(page, editor, '@Da')
    expect(Math.abs(popupBox.x - tokenBox.x)).toBeLessThan(2)
    expect(popupBox.y - (tokenBox.y + tokenBox.height)).toBeGreaterThanOrEqual(0)
    expect(popupBox.y - (tokenBox.y + tokenBox.height)).toBeLessThan(8)

    // ⏎ picks the canonical (quoted) token — no newline.
    await page.keyboard.press('Enter')
    await expect(popup(page)).toBeHidden()
    expect(await lineWith(editor, '- Call')).toBe('- Call @"Dana Kim" ')
    await expect(editor.locator('.cm-line')).toHaveCount(1)

    // Tab picks a tag.
    await page.keyboard.type('#q')
    await expect(popup(page).getByRole('option')).toHaveText(['#q4'])
    await page.keyboard.press('Tab')
    expect(await lineWith(editor, '- Call')).toBe('- Call @"Dana Kim" #q4 ')

    // `/` → command → argument state → parsed date.
    await page.keyboard.type('/du')
    await expect(popup(page)).toHaveAttribute('aria-label', 'Commands')
    await page.keyboard.press('Enter')
    await expect(popup(page)).toHaveAttribute('aria-label', 'Due date')
    await page.keyboard.type('fri')
    await page.keyboard.press('Enter')
    await expect(popup(page)).toBeHidden()
    expect(await lineWith(editor, '- Call')).toBe('- Call @"Dana Kim" #q4 /due fri ')
    await expect(editor.locator('.cm-nlp-tint[data-tint="due"]')).toHaveText('/due fri')

    // `/status` quotes a multi-word status.
    await page.keyboard.type('/status in')
    await expect(popup(page).getByRole('option')).toHaveText(['In progress'])
    await page.keyboard.press('Enter')
    expect(await lineWith(editor, '- Call')).toBe('- Call @"Dana Kim" #q4 /due fri /status "In progress" ')

    // ↓ moves the active row (no wrap); Esc closes only the popup and the
    // text stays; the next ⏎ is a newline again.
    await page.keyboard.type('@')
    await expect(popup(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(popup(page).getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(popup(page)).toBeHidden()
    await expect(page.getByRole('region', { name: 'Notes cell' })).toBeVisible()
    await expect(editor).toBeFocused()
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Enter')
    await expect(editor.locator('.cm-line')).toHaveCount(2)

    // Create rows create the person / tag on pick, before any conversion.
    // (⏎ on a list line continued the `- ` marker.)
    await page.keyboard.type('Call legal @Marco')
    await expect(popup(page).getByRole('option')).toHaveText(['MPress ⏎ to create @Marco'])
    await page.keyboard.press('Enter')
    await expect.poll(() => storedNames(page, 'people')).toContain('Marco')
    // A person that exists now tints as a known one.
    await expect(editor.locator('.cm-nlp-tint', { hasText: '@Marco' })).toHaveAttribute('data-tint', 'chip')
    await page.keyboard.type('#launch')
    await page.keyboard.press('Enter')
    await expect.poll(() => storedNames(page, 'tags')).toContain('launch')
    expect(await lineWith(editor, 'legal')).toBe('- Call legal @Marco #launch ')
  })

  test('an email address in a note is plain text and converts without a person', async ({ page }) => {
    await seedWorkspace(page, NOTES_LAYOUT)
    const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
    await editor.click()
    await page.keyboard.type('Mail bob@acme.com about the SOW')
    await expect(popup(page)).toBeHidden()
    await expect(editor.locator('.cm-nlp-tint')).toHaveCount(0)
    // Alt+T opens the task popup prefilled from the line; ⏎ creates.
    await page.keyboard.press('Alt+t')
    await expect(page.getByRole('textbox', { name: /^New task…/ })).toHaveValue('Mail bob@acme.com about the SOW')
    await page.keyboard.press('Enter')
    await expect(editor.locator('.cm-line').first()).toHaveText('✓ Mail bob@acme.com about the SOW')
    expect(await storedNames(page, 'people')).toEqual(['Anna', 'Dana Kim'])
    const titles = (await readStore<{ title: string }>(page, 'todos')).map((t) => t.title)
    expect(titles).toEqual(['Mail bob@acme.com about the SOW'])
  })

  test('Notes widget: flips above the caret near the bottom edge', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 420 })
    await seedWorkspace(page, NOTES_LAYOUT)
    const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
    await editor.click()
    for (let i = 0; i < 30; i++) await page.keyboard.press('Enter')
    await page.keyboard.type('Plan /')
    await expect(popup(page)).toHaveAttribute('aria-label', 'Commands')
    const { tokenBox, popupBox } = await boxes(page, editor, '/')
    expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(tokenBox.y)
    expect(popupBox.y).toBeGreaterThanOrEqual(0)
  })

  test('task editor notes: above the dialog, mouse pick, Esc keeps the dialog', async ({ page }) => {
    await seedTaskList(page, { people: ['Anna', 'Dana Kim'], tasks: [{ title: 'alpha', notes: 'Some notes' }] })
    await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
    const title = page.getByRole('textbox', { name: 'Task title' })
    await expect(title).toBeVisible()
    const editor = page.locator('.cm-content')
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' with @an')
    await expect(popup(page)).toBeVisible()
    // Nothing of the dialog covers the popup.
    const box = await popup(page).boundingBox()
    if (!box) throw new Error('no popup box')
    const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-nlp-popup]'),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(onTop).toBe(true)

    await popup(page).getByRole('option', { name: '@Anna' }).click()
    await expect(popup(page)).toBeHidden()
    await expect(editor).toHaveText('Some notes with @Anna ')
    await expect(editor).toBeFocused()

    await page.keyboard.type('@d')
    await expect(popup(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup(page)).toBeHidden()
    await expect(title).toBeVisible()
  })

  test('row notes popover: a mouse pick keeps it open; Esc closes the popup first', async ({ page }) => {
    await seedTaskList(page, { people: ['Anna', 'Dana Kim'], tasks: [{ title: 'alpha', notes: 'Some notes' }] })
    await taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Edit progress and notes' }).click()
    const popover = page.getByRole('dialog', { name: 'Progress and notes' })
    await expect(popover).toBeVisible()
    const editor = popover.locator('.cm-content')
    await editor.click()
    await page.keyboard.press('End')
    await page.keyboard.type(' and @da')
    await popup(page).getByRole('option', { name: '@Dana Kim' }).click()
    await expect(popover).toBeVisible()
    await expect(editor).toHaveText('Some notes and @"Dana Kim" ')

    await page.keyboard.type('@a')
    await expect(popup(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup(page)).toBeHidden()
    await expect(popover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
  })
})
