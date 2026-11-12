import { expect, test } from '@playwright/test'
import { openSettings, seedTaskList } from './fixtures/workspace'
import { readStores } from './fixtures/db'

/**
 * Schema v80 in a real browser: an export the deployed v79 build wrote —
 * people with email addresses and the check-in open method's settings row —
 * imported through Settings › Import / Export › Import JSON arrives in the
 * v80 shape: no warning about either, the people stored without an email,
 * the open method gone, the check-in filter kept; the People editor shows
 * no Email field and Settings no "open as" row.
 */

const IMPORT_FILE = 'v79-export.json'
const AT = '2026-11-01T09:00:00.000Z'
const FILTER = JSON.stringify({ showCompleted: false, personIds: null, statusIds: null, searchText: 'review', dates: {}, markers: null, tags: null })

const V79_FILE = {
  __schemaVersion: 79,
  todos: [{ id: 1, uid: 'u-1', title: 'Imported task', isCompleted: false, sortOrder: 0, createdAt: AT, modifiedAt: AT }],
  people: [
    { id: 1, name: 'Aisha Rahman', initials: 'AR', color: '#336699', email: 'aisha@example.com' },
    { id: 2, name: 'Ben Ortiz', initials: 'BO', email: 'ben@example.com' },
  ],
  todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
  settings: [
    { key: 'checkinOpenMethod', value: 'eml' },
    { key: 'checkinTaskFilter', value: FILTER },
  ],
}

test('a v79 export imported through Settings arrives in the v80 shape: no addresses, no open method, no warning', async ({ page }) => {
  await page.addInitScript((name) => {
    const handle = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await handle()], configurable: true })
  }, IMPORT_FILE)
  await seedTaskList(page, { tasks: [{ title: 'Before' }] })
  await page.evaluate(async ({ name, text }) => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    const w = await file.createWritable()
    await w.write(text)
    await w.close()
  }, { name: IMPORT_FILE, text: JSON.stringify(V79_FILE) })

  const settings = await openSettings(page, 'Import / Export')
  await settings.getByRole('button', { name: 'Import JSON' }).click()
  // No warning: the addresses and the open method went with the upgrade, not as fixes.
  await expect(settings.getByText('Imported successfully!')).toBeVisible()
  await expect(settings.getByText(/email|checkinOpenMethod|unrecognized/i)).toHaveCount(0)

  const { people, settings: rows } = await readStores(page, ['people', 'settings'])
  expect(people).toEqual([
    { id: 1, name: 'Aisha Rahman', initials: 'AR', color: '#336699' },
    { id: 2, name: 'Ben Ortiz', initials: 'BO' },
  ])
  const keys = rows.map((r) => r.key)
  expect(keys).not.toContain('checkinOpenMethod')
  expect(rows.find((r) => r.key === 'checkinTaskFilter')?.value).toContain('"searchText":"review"')

  // Settings › People, statuses & tags: no "open as" row; the People editor has no Email field.
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'People, statuses & tags', exact: true }).click()
  await expect(settings.getByRole('heading', { level: 2, name: 'People, statuses & tags' })).toBeVisible()
  await expect(settings.getByRole('radiogroup')).toHaveCount(0)
  await expect(settings.getByText(/check-ins open as/i)).toHaveCount(0)
  await settings.getByRole('button', { name: 'Manage people…' }).click()
  await page.getByText('Aisha Rahman', { exact: true }).click()
  await expect(page.getByPlaceholder('Name')).toHaveValue('Aisha Rahman')
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)
  await expect(page.getByText('aisha@example.com')).toHaveCount(0)
})
