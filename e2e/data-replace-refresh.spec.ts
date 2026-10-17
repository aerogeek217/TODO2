import { expect, test, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { openSettings, seedTaskList, seedWorkspace } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * After the data is replaced (import, backup restore, sync file load) the
 * row selection and an open task editor are cleared: their task ids may now
 * name other tasks. A note save that started before the replace can't land
 * after it.
 */

test.use({ viewport: { width: 1280, height: 800 } })

/** A manual backup of the current data, made in Settings › Backups (left open). */
async function createBackup(page: Page) {
  const settings = await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByText('Backup created!')).toBeVisible()
  return settings
}

async function manualBackupId(page: Page): Promise<number> {
  const manual = (await readStore<{ id: number; trigger: string }>(page, 'backups')).find((b) => b.trigger === 'manual')
  if (!manual) throw new Error('no manual backup')
  return manual.id
}

test('restoring a backup clears the row selection', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }, { title: 'gamma' }] })
  const settings = await createBackup(page)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await selectTaskRowByTitle(page, 'alpha')
  await taskRowByTitle(page, 'gamma').locator('span[data-task-title="gamma"]').click({ modifiers: ['Shift'] })
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

  await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
  const title = page.getByRole('textbox', { name: 'Task title' })
  await expect(title).toHaveValue('alpha')

  // The restore Settings › Backups runs (the editor covers the app meanwhile,
  // as when a sync file loads under it).
  const outcome = await page.evaluate(async (id) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/file-ops-store.ts' as string)) as {
      useFileOpsStore: { getState(): { restoreBackup(id: number): Promise<{ status: string }> } }
    }
    return (await mod.useFileOpsStore.getState().restoreBackup(id)).status
  }, backupId)
  expect(outcome).toBe('done')

  await expect(title).toBeHidden()
  await expect(taskRowByTitle(page, 'alpha')).toBeVisible()
})

async function storedNotes(page: Page): Promise<string[]> {
  return (await readStore<{ content: string }>(page, 'notes')).map((n) => n.content)
}


interface NoteHoldWindow {
  __noteSaveStarted?: boolean
  __releaseNoteSave?: () => void
  __noteHoldAsked?: boolean
}

/** The notes held by the newest pre-op backup (the one a restore takes first). */
async function preOpBackupNotes(page: Page): Promise<string[]> {
  const newest = (await readStore<{ trigger: string; data: string }>(page, 'backups')).filter((b) => b.trigger === 'pre-destructive').at(-1)
  return newest ? (JSON.parse(newest.data) as { notes: Array<{ content: string }> }).notes.map((n) => n.content) : []
}

test('note text saving when a backup restore starts goes into its pre-op backup, not over the restored note', async ({ page }) => {
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

  // Hold the next note save's database write, and note when a replace asks
  // the note store to hold its saves (the app's own module instances).
  await page.evaluate(async () => {
    const repo = (await import(/* @vite-ignore */ '/src/data/note-repository.ts' as string)) as {
      noteRepository: { saveContent: (...args: unknown[]) => Promise<boolean> }
    }
    const notes = (await import(/* @vite-ignore */ '/src/stores/note-store.ts' as string)) as {
      useNoteStore: {
        getState(): { holdForDataReplace?: () => Promise<() => void> }
        setState(patch: Record<string, unknown>): void
      }
    }
    const w = window as unknown as NoteHoldWindow
    const write = repo.noteRepository.saveContent.bind(repo.noteRepository)
    const gate = new Promise<void>((resolve) => { w.__releaseNoteSave = resolve })
    repo.noteRepository.saveContent = async (...args: unknown[]) => {
      repo.noteRepository.saveContent = write
      w.__noteSaveStarted = true
      await gate
      return write(...args)
    }
    const hold = notes.useNoteStore.getState().holdForDataReplace
    if (hold) notes.useNoteStore.setState({ holdForDataReplace: () => { w.__noteHoldAsked = true; return hold() } })
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
  await expect.poll(async () => await restored.isVisible()
    || await page.evaluate(() => (window as unknown as NoteHoldWindow).__noteHoldAsked === true)).toBe(true)
  await page.evaluate(() => { (window as unknown as NoteHoldWindow).__releaseNoteSave?.() })
  await expect(restored).toBeVisible()
  await page.keyboard.press('Escape')

  await expect(editor).toHaveText('in the backup')
  await expect.poll(() => storedNotes(page)).toEqual(['in the backup'])
  // The text that was saving is in the backup the restore took first.
  expect(await preOpBackupNotes(page)).toEqual(['in the backup typed later'])
})
