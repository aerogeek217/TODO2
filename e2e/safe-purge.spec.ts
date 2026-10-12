import { expect, test, type Page } from '@playwright/test'
import { openSettings } from './fixtures/workspace'

/**
 * Safe purge: the launch prompt for completed tasks past the
 * retention setting, "Export & delete" to a task archive, and the append
 * import's duplicate picker — dialogs + focus + real file pickers, so a real
 * browser.
 *
 * Both File System Access pickers are stubbed with a REAL
 * `FileSystemFileHandle` from the Origin Private File System (same approach
 * as `file-sync-conflict.spec.ts`); everything after the picker is the
 * production code path.
 */

const ARCHIVE_FILE = 'e2e-archive.json'
const DB_NAME = 'todo2'

async function stubPickers(page: Page) {
  await page.addInitScript((name) => {
    const handle = async () => {
      const dir = await navigator.storage.getDirectory()
      return dir.getFileHandle(name, { create: true })
    }
    Object.defineProperty(window, 'showSaveFilePicker', { value: handle, configurable: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await handle()], configurable: true })
  }, ARCHIVE_FILE)
}

async function readArchive(page: Page): Promise<string> {
  return page.evaluate(async (name) => {
    const dir = await navigator.storage.getDirectory()
    const fh = await dir.getFileHandle(name, { create: true })
    return (await fh.getFile()).text()
  }, ARCHIVE_FILE)
}

interface SeedTodo { title: string; completedDaysAgo?: number }

/** Raw-IDB seed: the given todos + the retention setting. */
async function seed(page: Page, todos: SeedTodo[], retentionDays: number) {
  await page.evaluate(async ({ db, todos, retentionDays }) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['todos', 'settings'], 'readwrite')
        const now = Date.now()
        todos.forEach((t, i) => {
          const done = t.completedDaysAgo != null
          const row: Record<string, unknown> = {
            uid: crypto.randomUUID(), title: t.title, isCompleted: done,
            createdAt: new Date(now - 100 * 86_400_000), modifiedAt: new Date(now), sortOrder: i + 1,
          }
          if (done) row.completedAt = new Date(now - (t.completedDaysAgo ?? 0) * 86_400_000)
          tx.objectStore('todos').add(row)
        })
        tx.objectStore('settings').put({ key: 'completedRetentionDays', value: String(retentionDays) })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB_NAME, todos, retentionDays })
}

async function dbTodos(page: Page): Promise<Array<{ title: string; uid: string; isCompleted: boolean }>> {
  return page.evaluate(async (db) => new Promise((resolve, reject) => {
    const req = indexedDB.open(db)
    req.onsuccess = () => {
      const r = req.result.transaction(['todos'], 'readonly').objectStore('todos').getAll()
      r.onsuccess = () => { req.result.close(); resolve(r.result) }
      r.onerror = () => reject(r.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

async function boot(page: Page, path = '/') {
  await page.goto(path)
  if (path === '/') await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

test('launch prompt: Not now skips one launch; Export & delete archives, deletes, and the archive appends back with the duplicate picker', async ({ page }) => {
  await stubPickers(page)
  await boot(page)
  await seed(page, [
    { title: 'Old A', completedDaysAgo: 60 },
    { title: 'Old B', completedDaysAgo: 45 },
    { title: 'Recent done', completedDaysAgo: 2 },
    { title: 'Old B' }, // active twin — a title duplicate on re-import
    { title: 'Active' },
  ], 30)

  await page.reload()
  const prompt = page.getByRole('dialog', { name: 'Delete 2 old completed tasks?' })
  await expect(prompt).toBeVisible()
  await expect(prompt.getByTestId('purge-task-list')).toContainText('Old A')
  await expect(prompt.getByTestId('purge-task-list')).toContainText('Old B')
  await expect(prompt.getByTestId('purge-task-list')).not.toContainText('Recent done')
  // Focus lands inside the dialog, on the safe choice.
  await expect(prompt.getByRole('button', { name: 'Not now' })).toBeFocused()

  // Not now → nothing deleted; asked again on the next launch.
  await prompt.getByRole('button', { name: 'Not now' }).click()
  await expect(prompt).toBeHidden()
  expect((await dbTodos(page)).map((t) => t.title).sort()).toEqual(['Active', 'Old A', 'Old B', 'Old B', 'Recent done'])
  await page.reload()
  await expect(prompt).toBeVisible()

  // Export & delete → archive written first, then exactly those two deleted.
  await prompt.getByRole('button', { name: 'Export & delete' }).click()
  await expect(prompt).toBeHidden()
  const archive = JSON.parse(await readArchive(page)) as { kind: string; todos: Array<{ title: string; uid: string }> }
  expect(archive.kind).toBe('task-archive')
  expect(archive.todos.map((t) => t.title).sort()).toEqual(['Old A', 'Old B'])
  expect((await dbTodos(page)).map((t) => t.title).sort()).toEqual(['Active', 'Old B', 'Recent done'])

  // Next launch: nothing expired, no prompt.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Append the archive back: Old B is a title duplicate of the active task.
  await page.goto('/#/settings')
  await (await openSettings(page, 'Import / Export')).getByRole('button', { name: 'Import tasks (append)…' }).click()
  const picker = page.getByRole('dialog', { name: `Import tasks from ${ARCHIVE_FILE}` })
  await expect(picker).toBeVisible()
  await expect(picker.locator(':focus')).toHaveCount(1)
  const rows = picker.getByTestId('append-import-row')
  await expect(rows).toHaveCount(2)
  const dupRow = rows.filter({ hasText: 'Same title as an active task' })
  await expect(dupRow).toContainText('Old B')
  await expect(dupRow.getByRole('button', { name: 'Skip' })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker.getByRole('button', { name: 'Import 1 task' })).toBeVisible()

  // Per-row choice, then apply-to-all back to Skip, then per-row again.
  await dupRow.getByRole('button', { name: 'Import as new' }).click()
  await expect(picker.getByRole('button', { name: 'Import 2 tasks' })).toBeVisible()
  await picker.getByRole('button', { name: 'Skip', exact: true }).first().click() // "All duplicates: Skip"
  await expect(picker.getByRole('button', { name: 'Import 1 task' })).toBeVisible()
  await dupRow.getByRole('button', { name: 'Import as new' }).click()
  await picker.getByRole('button', { name: 'Import 2 tasks' }).click()
  await expect(picker).toBeHidden()
  await expect(page.getByText('Imported 2 tasks.')).toBeVisible()

  const after = await dbTodos(page)
  expect(after.map((t) => t.title).sort()).toEqual(['Active', 'Old A', 'Old B', 'Old B', 'Recent done'])
  // Re-imported tasks keep their archived uids (no collision after the purge).
  const archivedUids = new Set(archive.todos.map((t) => t.uid))
  expect(after.filter((t) => archivedUids.has(t.uid)).map((t) => t.title).sort()).toEqual(['Old A', 'Old B'])
})

test('launch prompt: Delete removes the expired tasks without a file; a cancelled file picker deletes nothing', async ({ page }) => {
  await page.addInitScript(() => {
    const abort = async () => { throw new DOMException('cancelled', 'AbortError') }
    Object.defineProperty(window, 'showSaveFilePicker', { value: abort, configurable: true })
  })
  await boot(page)
  await seed(page, [{ title: 'Stale', completedDaysAgo: 20 }, { title: 'Keep' }], 7)

  await page.reload()
  const prompt = page.getByRole('dialog', { name: 'Delete 1 old completed task?' })
  await expect(prompt).toBeVisible()

  await prompt.getByRole('button', { name: 'Export & delete' }).click()
  // Picker cancelled → still asking, nothing deleted.
  await expect(prompt).toBeVisible()
  await expect(prompt.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled()
  expect((await dbTodos(page)).map((t) => t.title).sort()).toEqual(['Keep', 'Stale'])

  await prompt.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(prompt).toBeHidden()
  expect((await dbTodos(page)).map((t) => t.title)).toEqual(['Keep'])
})
