import { expect, test, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { openSettings, seedTaskList, seedWorkspace } from './fixtures/workspace'

/**
 * After the data is replaced (import, backup restore, sync file load) the
 * row selection and an open task editor are cleared: their task ids may now
 * name other tasks. A note save that started before the replace can't land
 * after it.
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

async function storedNotes(page: Page): Promise<string[]> {
  return page.evaluate(async (db) => new Promise<string[]>((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['notes'], 'readonly').objectStore('notes').getAll()
      r.onsuccess = () => { req.result.close(); resolve((r.result as Array<{ content: string }>).map((n) => n.content)) }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

interface NoteHoldWindow {
  __noteSaveStarted?: boolean
  __releaseNoteSave?: () => void
}

test('a note save started before a backup restore does not land after it', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' }] }] }] }],
  })
  const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
  await editor.click()
  await page.keyboard.type('in the backup')
  await expect.poll(() => storedNotes(page)).toEqual(['in the backup'])
  const settings = await createBackup(page)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // Hold the next note save's database write (the app's own module instance).
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/data/note-repository.ts')) as {
      noteRepository: { saveContent: (...args: unknown[]) => Promise<boolean> }
    }
    const w = window as unknown as NoteHoldWindow
    const write = mod.noteRepository.saveContent.bind(mod.noteRepository)
    const gate = new Promise<void>((resolve) => { w.__releaseNoteSave = resolve })
    mod.noteRepository.saveContent = async (...args: unknown[]) => {
      mod.noteRepository.saveContent = write
      w.__noteSaveStarted = true
      await gate
      return write(...args)
    }
  })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' typed later')
  await expect.poll(() => page.evaluate(() => (window as unknown as NoteHoldWindow).__noteSaveStarted === true)).toBe(true)

  await openSettings(page, 'Backups')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  const restored = settings.getByText('Restored successfully! The data it replaced was backed up first.')
  // The restore is under way: done already, or waiting for the held save.
  await expect.poll(async () => await restored.isVisible() || await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/note-store.ts')) as {
      useNoteStore: { getState(): { replaceHolds?: number } }
    }
    return (mod.useNoteStore.getState().replaceHolds ?? 0) > 0
  })).toBe(true)
  await page.evaluate(() => { (window as unknown as NoteHoldWindow).__releaseNoteSave?.() })
  await expect(restored).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(editor).toHaveText('in the backup')
  await expect.poll(() => storedNotes(page)).toEqual(['in the backup'])
})
