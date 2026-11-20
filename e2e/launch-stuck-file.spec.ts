import type { Page } from '@playwright/test'
import { expect, test } from './fixtures/test'
import { readStore, readStores, writeStores } from './fixtures/db'
import { attachSyncHandle, readSyncFile } from './fixtures/sync-file'

/**
 * Launch when the browser never answers about the attached sync file (a
 * stored handle it can no longer resolve has been seen to do that): the app
 * must not sit on `Loading…` without end. The permission check is given a
 * few seconds, then the launch question says the link could not be checked;
 * so is reading the stored link, after which the app opens with sync off;
 * a file read has no time limit, but the start screen names the step and
 * offers Continue without the file and Forget the sync file. The handle is a
 * real OPFS file stored where the app keeps its handle; `stubStuckFile`
 * makes the read of that stored link, its permission check or its read wait
 * for as long as the test says.
 */

const SYNC_FILE = 'e2e-stuck.json'
const STUCK_KEY = 'e2e-stuck-file'
/** The waits the app itself makes before it says anything (5 s, then 6 s), with room for a slow machine. */
const SLOW = { timeout: 20_000 }

type Stuck = 'link' | 'permission' | 'read'
type StuckWindow = Window & { __e2eStuck?: Stuck | null }

/** File handles whose `queryPermission` or `getFile` — or whose stored link's read — never answers while `stick` says so (kept across reloads). */
async function stubStuckFile(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    const w = window as StuckWindow
    w.__e2eStuck = localStorage.getItem(key) as Stuck | null
    const proto = FileSystemFileHandle.prototype as unknown as {
      queryPermission: (this: FileSystemFileHandle) => Promise<PermissionState>
      getFile: (this: FileSystemFileHandle) => Promise<File>
    }
    const realGetFile = proto.getFile
    proto.queryPermission = () => (w.__e2eStuck === 'permission' ? new Promise(() => {}) : Promise.resolve('granted'))
    proto.getFile = function getFile() {
      return w.__e2eStuck === 'read' ? new Promise(() => {}) : realGetFile.call(this)
    }
    // The stored link's row: a request that never fires.
    const realGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function get(this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (w.__e2eStuck === 'link' && this.name === 'handles') return {} as IDBRequest
      return realGet.call(this, key)
    }
  }, STUCK_KEY)
}

/** From the next load on, the browser never answers that step — or, with `null`, answers again at once. */
async function stick(page: Page, what: Stuck | null): Promise<void> {
  await page.evaluate(({ key, what }) => {
    if (what) localStorage.setItem(key, what)
    else localStorage.removeItem(key);
    (window as StuckWindow).__e2eStuck = what
  }, { key: STUCK_KEY, what })
}

async function schemaVersion(page: Page): Promise<number> {
  return page.evaluate(async (url) => {
    const mod = (await import(/* @vite-ignore */ url)) as { CURRENT_DB_VERSION: number }
    return mod.CURRENT_DB_VERSION
  }, '/src/data/database.ts')
}

/** A booted app with one task and the sync file attached, holding this browser's data. Returns the file's text. */
async function setUp(page: Page): Promise<string> {
  await stubStuckFile(page)
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  const at = new Date()
  await writeStores(page, {
    add: { todos: [{ uid: crypto.randomUUID(), title: 'Keep me', isCompleted: false, createdAt: at, modifiedAt: at, sortOrder: 0 }] },
  })
  const data = JSON.parse(JSON.stringify(await readStores(page))) as Record<string, unknown>
  delete data.backups
  const text = JSON.stringify({ ...data, __schemaVersion: await schemaVersion(page), savedAt: new Date().toISOString() })
  await attachSyncHandle(page, SYNC_FILE, text)
  return text
}

/** The name of the file whose handle the app has stored, or null. */
async function storedLink(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const open = indexedDB.open('todo2-meta', 1)
    open.onupgradeneeded = () => { open.result.createObjectStore('handles') }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const get = open.result.transaction('handles').objectStore('handles').get('todo2-primary')
      get.onerror = () => reject(get.error)
      get.onsuccess = () => {
        open.result.close()
        resolve((get.result as FileSystemFileHandle | undefined)?.name ?? null)
      }
    }
  }))
}

// Each test waits out the app's own timeouts (5 s, then 6 s) on top of two or
// three launches: three times the usual limit.
test.beforeEach(() => { test.slow() })

const taskTitles = async (page: Page) => (await readStore<{ title: string }>(page, 'todos')).map((t) => t.title)
const startScreen = (page: Page) => page.getByTestId('start-screen')
const workspace = (page: Page) => page.locator('[data-ws-area]').first()

test('a permission check that never answers: the launch question after a few seconds; Continue opens this browser’s data', async ({ page }) => {
  const fileText = await setUp(page)
  await stick(page, 'permission')
  await page.reload()

  // Loading… at first, nothing to press.
  await expect(startScreen(page)).toHaveText('Loading…')
  await expect(startScreen(page).getByRole('button')).toHaveCount(0)

  const question = page.getByRole('dialog', { name: `Allow access to ${SYNC_FILE}` })
  await expect(question).toBeVisible(SLOW)
  await expect(question).toContainText('its link to the file could not be checked: your browser didn’t answer.')
  await expect(question.getByRole('button', { name: 'Grant access…' })).toBeFocused()
  await expect(page.getByTestId('storage-pill')).toHaveCount(0)

  await question.getByRole('button', { name: /Continue without the file/ }).click()
  await workspace(page).waitFor({ state: 'visible' })
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'permission')
  expect(await taskTitles(page)).toContain('Keep me')
  // Nothing read into the file, nothing forgotten.
  expect(await storedLink(page)).toBe(SYNC_FILE)
  expect(await readSyncFile(page, SYNC_FILE)).toBe(fileText)
})

test('a file read that never ends: the start screen names the step; Forget the sync file clears the link and keeps the tasks', async ({ page }) => {
  const fileText = await setUp(page)
  const before = await taskTitles(page)
  await stick(page, 'read')
  await page.reload()

  await expect(startScreen(page)).toHaveText('Loading…')
  const start = startScreen(page)
  await expect(start.getByRole('heading', { name: 'Still checking the sync file…' })).toBeVisible(SLOW)
  await expect(start.getByRole('button')).toHaveText(['Reload', 'Forget the sync file…', 'Continue without the file'])
  await expect(start).toContainText('nothing is written to the file')

  // Forget asks first; Cancel (the default, and Esc) forgets nothing.
  await start.getByRole('button', { name: 'Forget the sync file…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Forget the sync file?' })
  await expect(confirm).toContainText('Your tasks and the file itself stay as they are.')
  await expect(confirm.getByRole('button', { name: /Cancel/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(confirm).toBeHidden()
  expect(await storedLink(page)).toBe(SYNC_FILE)

  await start.getByRole('button', { name: 'Forget the sync file…' }).click()
  await confirm.getByRole('button', { name: 'Forget the sync file' }).click()
  await workspace(page).waitFor({ state: 'visible' })
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'local')
  await expect.poll(() => storedLink(page)).toBeNull()
  expect(await taskTitles(page)).toEqual(before)
  await stick(page, null)
  expect(await readSyncFile(page, SYNC_FILE)).toBe(fileText)

  // The next start has no file to wait for.
  await page.reload()
  await workspace(page).waitFor({ state: 'visible' })
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'local')
})

test('a file read that never ends: Continue without the file opens this browser’s data, sync paused; Retry loads the file', async ({ page }) => {
  const fileText = await setUp(page)
  await stick(page, 'read')
  await page.reload()

  const start = startScreen(page)
  await start.getByRole('button', { name: 'Continue without the file' }).click(SLOW)
  await workspace(page).waitFor({ state: 'visible' })
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'paused')
  expect(await taskTitles(page)).toContain('Keep me')
  expect(await storedLink(page)).toBe(SYNC_FILE)

  await pill.click()
  const popover = page.getByTestId('storage-popover')
  await expect(popover).toContainText(`You continued without ${SYNC_FILE} while your browser was still reading it. Retry loads it.`)
  await expect(popover).toContainText('Nothing has been written to either side.')

  // The browser answers again: Retry runs the usual load decision.
  await stick(page, null)
  await popover.getByRole('button', { name: 'Retry' }).click()
  await expect(pill).toHaveAttribute('data-state', 'syncing')
  expect(await taskTitles(page)).toContain('Keep me')
  expect(JSON.parse(await readSyncFile(page, SYNC_FILE))).toMatchObject({ todos: JSON.parse(fileText).todos })
})

test('a stored link that is never read: the app opens with Sync off, which stays; its edits reach the file at the next start', async ({ page }) => {
  await setUp(page)
  // A first start that syncs: this browser and the file hold the same data, on record.
  await page.reload()
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'syncing')
  const synced = await readSyncFile(page, SYNC_FILE)

  await stick(page, 'link')
  await page.reload()
  await workspace(page).waitFor({ state: 'visible', ...SLOW })
  await expect(pill).toHaveAttribute('data-state', 'unchecked')
  await expect(pill).toHaveText('Sync off')

  // Its section has Reload and nothing that dismisses it.
  await pill.click()
  const section = page.getByTestId('storage-popover').locator('[data-warning="unchecked"]')
  await expect(section).toContainText('TODO2 could not check its sync file when it started')
  await expect(section.getByRole('button')).toHaveText(['Reload'])
  await page.keyboard.press('Escape')
  await expect(pill).toHaveAttribute('data-state', 'unchecked')

  // An edit meanwhile stays in this browser, recorded as unsynced.
  await page.keyboard.press('Control+Space')
  await page.getByRole('dialog', { name: 'Quick add task' }).getByPlaceholder('New task…').fill('Edit while sync was off')
  await page.keyboard.press('Enter')
  await expect.poll(() => taskTitles(page)).toContain('Edit while sync was off')
  await expect(pill).toHaveAttribute('data-state', 'unchecked')
  const record = JSON.parse(await page.evaluate(() => localStorage.getItem('todo2-file-sync-state')) ?? '{}') as { dirtySince?: string | null }
  expect(record.dirtySince).toBeTruthy()
  await stick(page, null)
  expect(await readSyncFile(page, SYNC_FILE)).toBe(synced)
  expect(await storedLink(page)).toBe(SYNC_FILE)

  // The next start reads the link: the file is unchanged, so the edit is written to it — never the file loaded over it.
  await page.reload()
  await expect(pill).toHaveAttribute('data-state', 'syncing')
  expect(await taskTitles(page)).toContain('Edit while sync was off')
  const titles = (JSON.parse(await readSyncFile(page, SYNC_FILE)) as { todos: Array<{ title: string }> }).todos.map((t) => t.title)
  expect(titles).toContain('Edit while sync was off')
})
