import { expect, test, type Page } from '@playwright/test'
import { gotoSettingsDeepLink, openSettings } from './fixtures/workspace'

/**
 * Backup retention: an automatic backup is taken at startup when the last
 * one is a day old (or there is none), each kind of backup keeps its own
 * newest few — so automatic and pre-op snapshots never push out a manual
 * backup or a sync file's backup — and an automatic backup that can't be
 * stored shows a warning instead of failing silently.
 */

const DB_NAME = 'todo2'
const DAY = 24 * 60 * 60 * 1000

interface BackupRow { id?: number; trigger: string; createdAt: string; sizeBytes: number; data: string }

async function dbBackups(page: Page): Promise<BackupRow[]> {
  return page.evaluate(async (db) => new Promise<BackupRow[]>((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['backups'], 'readonly').objectStore('backups').getAll()
      r.onsuccess = () => { req.result.close(); resolve(r.result as BackupRow[]) }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

function countByTrigger(rows: BackupRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.trigger] = (counts[r.trigger] ?? 0) + 1
  return counts
}

/** Replaces every stored backup with `rows`. */
async function replaceBackups(page: Page, rows: BackupRow[]) {
  await page.evaluate(async ({ db, rows }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const tx = req.result.transaction(['backups'], 'readwrite')
      const store = tx.objectStore('backups')
      store.clear()
      for (const row of rows) store.add(row)
      tx.oncomplete = () => { req.result.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  }), { db: DB_NAME, rows })
}

test('a startup backup is taken, and manual and sync-file backups outlive full pools of automatic and pre-op ones', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  // A fresh browser has no automatic backup, so startup takes one.
  await expect.poll(async () => countByTrigger(await dbBackups(page)).auto ?? 0).toBe(1)
  const snapshot = (await dbBackups(page))[0]!.data

  // Twelve automatic and twelve pre-op backups, all older than the manual
  // backup and the sync file's backup: under one shared pool of ten, those
  // two would be the first to go.
  const at = (daysAgo: number, minutes = 0) => new Date(Date.now() - daysAgo * DAY + minutes * 60_000).toISOString()
  const row = (trigger: string, createdAt: string, data = snapshot): BackupRow => ({ trigger, createdAt, sizeBytes: data.length, data })
  await replaceBackups(page, [
    row('manual', at(30)),
    row('sync-file', at(29), '{"__schemaVersion":49,"todos":[],"savedAt":"2026-09-14T10:00:00.000Z"}'),
    ...Array.from({ length: 12 }, (_, i) => row('auto', at(3, i))),
    ...Array.from({ length: 12 }, (_, i) => row('pre-destructive', at(3, i))),
  ])

  // The last automatic backup is three days old: a reload takes a new one
  // and keeps the newest ten automatic backups.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect.poll(async () => countByTrigger(await dbBackups(page)))
    .toEqual({ manual: 1, 'sync-file': 1, auto: 10, 'pre-destructive': 12 })
  const newestAuto = (await dbBackups(page)).filter((b) => b.trigger === 'auto').map((b) => b.createdAt).sort().at(-1)!
  expect(Date.now() - Date.parse(newestAuto)).toBeLessThan(DAY)

  // A destructive operation (restoring the manual backup) takes a pre-op
  // snapshot and keeps the newest ten of those; the manual backup stays.
  const settings = await gotoSettingsDeepLink(page)
  await openSettings(page, 'Backups')
  await expect(settings.locator('[data-trigger="sync-file"]')).toContainText('sync file')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  await expect(settings.getByText('Restored successfully! The data it replaced was backed up first.')).toBeVisible()
  expect(countByTrigger(await dbBackups(page))).toEqual({ manual: 1, 'sync-file': 1, auto: 10, 'pre-destructive': 10 })
  await expect(settings.locator('[data-trigger="manual"]')).toHaveCount(1)
  await expect(settings.locator('[data-trigger="sync-file"]')).toHaveCount(1)
})

test('an automatic or manual backup that cannot be stored warns instead of failing silently', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  // Every write to the backups store aborts its transaction — what a quota
  // error does — from the first load on.
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      const req = add.apply(this, args)
      if (this.name === 'backups') this.transaction.abort()
      return req
    }
  })
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })

  await expect(page.getByRole('alert').filter({ hasText: 'The automatic backup could not be saved' })).toBeVisible()
  expect(await dbBackups(page)).toEqual([])

  const settings = await gotoSettingsDeepLink(page)
  await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByRole('alert').filter({ hasText: 'The backup could not be saved' })).toBeVisible()
  await expect(settings.getByText('Backup created!')).toHaveCount(0)
  expect(errors).toEqual([])
})
