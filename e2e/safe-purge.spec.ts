import { expect, test, type Page } from '@playwright/test'
import { gotoSettingsDeepLink, openSettings } from './fixtures/workspace'
import { readStore, readStores, writeStores } from './fixtures/db'

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
  const now = Date.now()
  await writeStores(page, {
    add: {
      todos: todos.map((t, i) => ({
        uid: crypto.randomUUID(), title: t.title, isCompleted: t.completedDaysAgo != null,
        createdAt: new Date(now - 100 * 86_400_000), modifiedAt: new Date(now), sortOrder: i + 1,
        ...(t.completedDaysAgo != null ? { completedAt: new Date(now - t.completedDaysAgo * 86_400_000) } : {}),
      })),
    },
    put: { settings: [{ key: 'completedRetentionDays', value: String(retentionDays) }] },
  })
}

function dbTodos(page: Page): Promise<Array<{ title: string; uid: string; isCompleted: boolean }>> {
  return readStore(page, 'todos')
}

async function boot(page: Page, path = '/') {
  await page.goto(path)
  if (path === '/') await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

test('launch prompt: Not now waits the prompt interval; Export & delete archives, deletes, and the archive appends back with the duplicate picker', async ({ page }) => {
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

  // Showing it stamped the setting the interval counts from.
  await expect.poll(async () => (await readStore<{ key: string; value: string }>(page, 'settings')).find((r) => r.key === 'purgePromptLastAt')?.value)
    .toBeTruthy()

  // Not now → nothing deleted; not asked again within the interval (7 days by default).
  await prompt.getByRole('button', { name: 'Not now' }).click()
  await expect(prompt).toBeHidden()
  expect((await dbTodos(page)).map((t) => t.title).sort()).toEqual(['Active', 'Old A', 'Old B', 'Old B', 'Recent done'])
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Once the interval has passed: asked again.
  await writeStores(page, { put: { settings: [{ key: 'purgePromptLastAt', value: new Date(Date.now() - 7 * 86_400_000).toISOString() }] } })
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
  await gotoSettingsDeepLink(page)
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

/**
 * A browser with no expired tasks and, in OPFS, a sync file holding one
 * long-completed task, a 30-day retention and the given extra settings,
 * then Settings › File storage › Attach to File picks it.
 */
async function attachFileWithExpiredTask(page: Page, settings: Array<{ key: string; value: string }> = []) {
  const SYNC_FILE = 'e2e-purge-sync.json'
  await page.addInitScript((name) => {
    const pick = async () => {
      const dir = await navigator.storage.getDirectory()
      return [await dir.getFileHandle(name, { create: true })]
    }
    Object.defineProperty(window, 'showOpenFilePicker', { value: pick, configurable: true })
  }, SYNC_FILE)
  await boot(page)

  // The file: this browser's data plus one long-completed task and a 30-day retention.
  const data = JSON.parse(JSON.stringify(await readStores(page))) as Record<string, unknown[]>
  delete data.backups
  const now = Date.now()
  data.todos = [{
    id: 1, uid: crypto.randomUUID(), title: 'Old file task', isCompleted: true, sortOrder: 1,
    createdAt: new Date(now - 100 * 86_400_000).toISOString(), modifiedAt: new Date(now).toISOString(),
    completedAt: new Date(now - 60 * 86_400_000).toISOString(),
  }]
  data.settings = [...(data.settings ?? []), { key: 'completedRetentionDays', value: '30' }, ...settings]
  const schemaVersion = await page.evaluate(async (url) => {
    const mod = (await import(/* @vite-ignore */ url)) as { CURRENT_DB_VERSION: number }
    return mod.CURRENT_DB_VERSION
  }, '/src/data/database.ts')
  const text = JSON.stringify({ ...data, __schemaVersion: schemaVersion, savedAt: new Date(now).toISOString() })
  await page.evaluate(async ({ name, text }) => {
    const dir = await navigator.storage.getDirectory()
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable()
    await w.write(text)
    await w.close()
  }, { name: SYNC_FILE, text })

  // No prompt at launch: the browser had nothing expired.
  await expect(page.getByRole('dialog', { name: /old completed task/ })).toHaveCount(0)

  await gotoSettingsDeepLink(page)
  await (await openSettings(page, 'File storage')).getByRole('button', { name: 'Attach to File' }).click()
}

/**
 * The launch prompt's check runs again after a sync file is loaded later
 * (here: attached from Settings into a browser with no expired tasks), so
 * the file's own expired tasks are asked about too — unless the file's data
 * says the prompt showed within its interval.
 */
test('attaching a sync file with expired tasks brings up the prompt for them', async ({ page }) => {
  await attachFileWithExpiredTask(page)
  const prompt = page.getByRole('dialog', { name: 'Delete 1 old completed task?' })
  await expect(prompt).toBeVisible()
  await expect(prompt.getByTestId('purge-task-list')).toContainText('Old file task')
})

test('attaching a sync file whose prompt showed within its interval asks nothing', async ({ page }) => {
  await attachFileWithExpiredTask(page, [
    { key: 'purgePromptIntervalDays', value: '14' },
    { key: 'purgePromptLastAt', value: new Date(Date.now() - 10 * 86_400_000).toISOString() },
  ])
  // The file loaded (its task is here) …
  await expect.poll(async () => (await dbTodos(page)).map((t) => t.title)).toEqual(['Old file task'])
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'syncing')
  // … and nothing asked about it.
  await expect(page.getByRole('dialog', { name: /old completed task/ })).toHaveCount(0)
})
