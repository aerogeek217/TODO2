import { test, expect } from '@playwright/test'
import { seedWorkspace, wsRow } from './fixtures/workspace'

/**
 * A tab left open while another opens the database at a newer version (a
 * newer TODO2 after a deploy): Chromium fires `versionchange` on the old
 * tab's connection, which closes so the upgrade goes on, and the old tab is
 * blocked with a Reload instead of losing its edits one write at a time
 * (cr31 data L3). JSDOM's fake IndexedDB isn't authoritative for this.
 */

test('the database opened at a newer version in another tab blocks this one with Reload', async ({ page, context }) => {
  await seedWorkspace(page, { layouts: [{ name: 'Daily', columns: [{ id: 'c1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 'n1', kind: 'notes' }] })] }] }] })
  await expect(page.getByRole('region', { name: 'Notes cell' })).toBeVisible()

  // Another tab of the same origin, standing in for a newer build: opens the
  // raw database one version up — it waits until the first tab lets go.
  // (It runs the app too; its own connection lets go the same way.)
  const other = await context.newPage()
  await other.goto(page.url())
  await expect(other.getByRole('region', { name: 'Notes cell' })).toBeVisible()
  const version = await other.evaluate(() => new Promise<number>((resolve, reject) => {
    const probe = indexedDB.open('todo2')
    probe.onsuccess = () => {
      const current = probe.result.version
      probe.result.close()
      const req = indexedDB.open('todo2', current + 10)
      req.onsuccess = () => { const v = req.result.version; req.result.close(); resolve(v) }
      req.onerror = () => reject(new Error(String(req.error)))
      req.onblocked = () => reject(new Error('blocked: the first tab kept the database open'))
    }
    probe.onerror = () => reject(new Error(String(probe.error)))
  }))
  expect(version % 10).toBe(0)

  const dialog = page.getByRole('dialog', { name: 'TODO2 changed in another tab' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('A newer version of TODO2 opened this browser’s data in another tab or window.')
  await expect(dialog.getByRole('button')).toHaveText(['Reload'])
  await other.close()
})
