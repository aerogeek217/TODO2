import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A person's email address in Settings › People, statuses & tags: the
 * People editor's Email field checks the shape inline (after leaving the
 * field), refuses to save a bad address, and the saved address survives a
 * reload. The same section holds "Email check-ins open as".
 */

const seed: WorkspaceSeed = {
  people: ['Alice'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [{ title: 'Alice task', people: ['Alice'] }],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
  ],
}

const SHAPE_ERROR = "Doesn't look like an email address"

/** A row of the app's `settings` table, read straight from IndexedDB. */
function readSetting(page: Page, key: string): Promise<string | undefined> {
  return page.evaluate(async (key) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('todo2')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        const req = idb.transaction('settings').objectStore('settings').get(key)
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value)
        req.onerror = () => reject(req.error)
      })
    } finally {
      idb.close()
    }
  }, key)
}

async function openPeopleEditor(page: Page) {
  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage people…' }).click()
  await expect(page.getByText('Alice', { exact: true })).toBeVisible()
}

test('a person email: inline shape check, no save while bad, kept after a reload', async ({ page }) => {
  await seedWorkspace(page, seed)
  await openPeopleEditor(page)

  await page.getByText('Alice', { exact: true }).click()
  const email = page.getByRole('textbox', { name: 'Email' })
  await expect(email).toHaveValue('')
  await email.fill('alice@')
  await expect(page.getByText(SHAPE_ERROR)).toBeHidden() // not while typing
  await page.keyboard.press('Tab')
  await expect(page.getByText(SHAPE_ERROR)).toBeVisible()
  await expect(email).toHaveAttribute('aria-invalid', 'true')

  // Save is refused: the row stays open with the error.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(email).toBeVisible()
  await expect(page.getByText(SHAPE_ERROR)).toBeVisible()

  // Fixing it clears the error at once; then it saves.
  await email.fill('alice@example.com')
  await expect(page.getByText(SHAPE_ERROR)).toBeHidden()
  await expect(email).not.toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(email).toBeHidden()
  await expect(page.getByText('alice@example.com', { exact: true })).toBeVisible()

  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await openPeopleEditor(page)
  await expect(page.getByText('alice@example.com', { exact: true })).toBeVisible()
  await page.getByText('Alice', { exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveValue('alice@example.com')
})

test('Email check-ins open as: mail app by default, the .eml choice survives a reload', async ({ page }) => {
  await seedWorkspace(page, seed)
  let settings = await openSettings(page, 'People, statuses & tags')
  const group = settings.getByRole('radiogroup', { name: 'Email check-ins open as' })
  await expect(group.getByRole('radio', { name: /Open in mail app, then paste/ })).toBeChecked()
  await group.getByRole('radio', { name: /Download draft \(\.eml\)/ }).check()
  await expect.poll(() => readSetting(page, 'checkinOpenMethod')).toBe('eml')

  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  settings = await openSettings(page, 'People, statuses & tags')
  await expect(settings.getByRole('radio', { name: /Download draft \(\.eml\)/ })).toBeChecked()
  await expect(settings.getByRole('radio', { name: /Open in mail app/ })).not.toBeChecked()
})
