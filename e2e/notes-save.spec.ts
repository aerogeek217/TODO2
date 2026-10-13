import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace } from './fixtures/workspace'

/**
 * The global note in a real browser: two Notes widgets mounting at once
 * (StrictMode runs each load twice in dev) share one note, and typed text is
 * saved and survives a reload.
 */

/** Every stored note's text. */
async function storedNotes(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    return await new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open('todo2')
      req.onsuccess = () => {
        const idb = req.result
        const all = idb.transaction(['notes'], 'readonly').objectStore('notes').getAll()
        all.onsuccess = () => {
          idb.close()
          resolve((all.result as Array<{ content: string }>).map((r) => r.content))
        }
        all.onerror = () => { idb.close(); reject(all.error) }
      }
      req.onerror = () => reject(req.error)
    })
  })
}

const TWO_NOTES_LAYOUT = {
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'left', cells: [{ id: 'left-cell', tabs: [{ id: 'notes-a', kind: 'notes' as const }] }] },
      { id: 'right', cells: [{ id: 'right-cell', tabs: [{ id: 'notes-b', kind: 'notes' as const }] }] },
    ],
  }],
}

test('two Notes widgets share one note; typed text is saved and survives a reload', async ({ page }) => {
  await seedWorkspace(page, TWO_NOTES_LAYOUT)
  const cells = page.getByRole('region', { name: 'Notes cell' })
  await expect(cells).toHaveCount(2)
  const left = cells.nth(0).locator('.cm-content')
  const right = cells.nth(1).locator('.cm-content')

  // Both widgets loaded at once: one note seeded, not two.
  await expect.poll(() => storedNotes(page)).toEqual([''])

  await left.click()
  await page.keyboard.type('first line')
  await expect(right).toHaveText('first line')
  await expect.poll(() => storedNotes(page)).toEqual(['first line'])

  // Keep typing while that text is saved again: nothing typed is lost.
  await page.keyboard.type(' and more')
  await expect(left).toHaveText('first line and more')
  await expect.poll(() => storedNotes(page)).toEqual(['first line and more'])

  await page.reload()
  await expect(page.getByRole('region', { name: 'Notes cell' }).nth(0).locator('.cm-content')).toHaveText('first line and more')
  expect(await storedNotes(page)).toEqual(['first line and more'])
})
