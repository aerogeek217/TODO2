import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsRow } from './fixtures/workspace'

/**
 * Tab / ⇧Tab indent and outdent list lines in the notes editors (cr28, T6).
 * Real-browser because what Tab does when it is *not* ours — the focus
 * leaving the editor — is the browser's, and the "Esc then Tab leaves" rule
 * must hold against the real focus order.
 */

const NOTES_LAYOUT = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] })] }] }],
}

async function writeNote(page: Page, text: string): Promise<Locator> {
  await seedWorkspace(page, NOTES_LAYOUT)
  const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
  await editor.click()
  await page.keyboard.insertText(text)
  await expect(editor.locator('.cm-line')).toHaveCount(text.split('\n').length)
  return editor
}

const lines = (editor: Locator) => editor.locator('.cm-line').allTextContents()
const editorFocused = (editor: Locator) => editor.evaluate((el) => el.contains(document.activeElement))

test('Tab indents the caret’s bullet line, ⇧Tab outdents it, and the editor keeps the focus', async ({ page }) => {
  const editor = await writeNote(page, '- Q4 budget\n- Send the template')
  await page.keyboard.press('Tab')
  await expect.poll(() => lines(editor)).toEqual(['- Q4 budget', '  - Send the template'])
  expect(await editorFocused(editor)).toBe(true)
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => lines(editor)).toEqual(['- Q4 budget', '- Send the template'])
  expect(await editorFocused(editor)).toBe(true)
})

test('a selection over several bullets moves them together', async ({ page }) => {
  const editor = await writeNote(page, '- a\n- b\n- c')
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Tab')
  await expect.poll(() => lines(editor)).toEqual(['  - a', '  - b', '  - c'])
})

test('off a list line Tab leaves the editor as before', async ({ page }) => {
  const editor = await writeNote(page, '- a\nNotes from the call')
  await page.keyboard.press('Tab')
  await expect.poll(() => lines(editor)).toEqual(['- a', 'Notes from the call'])
  await expect.poll(() => editorFocused(editor)).toBe(false)
})

test('Esc then Tab leaves the editor even on a list line', async ({ page }) => {
  const editor = await writeNote(page, '- a')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect.poll(() => lines(editor)).toEqual(['- a'])
  await expect.poll(() => editorFocused(editor)).toBe(false)
  // Back in, a Tab indents again.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Tab')
  await expect.poll(() => lines(editor)).toEqual(['  - a'])
})
