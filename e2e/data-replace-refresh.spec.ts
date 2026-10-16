import { expect, test, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { openSettings, seedTaskList } from './fixtures/workspace'

/**
 * After the data is replaced (import, backup restore, sync file load) the
 * row selection and an open task editor are cleared: their task ids may now
 * name other tasks.
 */

test.use({ viewport: { width: 1280, height: 800 } })

const DB_NAME = 'todo2'

/** A manual backup of the current data, made in Settings › Backups (left open). */
async function createBackup(page: Page) {
  const settings = await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByText('Backup created!')).toBeVisible()
  return settings
}

async function manualBackupId(page: Page): Promise<number> {
  return page.evaluate(async (db) => new Promise<number>((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['backups'], 'readonly').objectStore('backups').getAll()
      r.onsuccess = () => {
        req.result.close()
        const manual = (r.result as Array<{ id: number; trigger: string }>).find((b) => b.trigger === 'manual')
        if (manual) resolve(manual.id)
        else reject(new Error('no manual backup'))
      }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

test('restoring a backup clears the row selection', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }, { title: 'gamma' }] })
  const settings = await createBackup(page)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await selectTaskRowByTitle(page, 'alpha')
  await taskRowByTitle(page, 'gamma').locator('span[title="gamma"]').click({ modifiers: ['Shift'] })
  await expect(page.locator('[data-selected="true"]')).toHaveCount(3)

  await openSettings(page, 'Backups')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  await expect(settings.getByText('Restored successfully! The data it replaced was backed up first.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await expect(taskRowByTitle(page, 'gamma')).toBeVisible()
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0)
})

test('a data replace while the task editor is open closes it', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }] })
  const settings = await createBackup(page)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  const backupId = await manualBackupId(page)

  await taskRowByTitle(page, 'alpha').locator('span[title="alpha"]').dblclick()
  const title = page.getByRole('textbox', { name: 'Task title' })
  await expect(title).toHaveValue('alpha')

  // The restore Settings › Backups runs (the editor covers the app meanwhile,
  // as when a sync file loads under it).
  const outcome = await page.evaluate(async (id) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/file-ops-store.ts')) as {
      useFileOpsStore: { getState(): { restoreBackup(id: number): Promise<{ status: string }> } }
    }
    return (await mod.useFileOpsStore.getState().restoreBackup(id)).status
  }, backupId)
  expect(outcome).toBe('done')

  await expect(title).toBeHidden()
  await expect(taskRowByTitle(page, 'alpha')).toBeVisible()
})
