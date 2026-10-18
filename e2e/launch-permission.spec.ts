import { expect, test, type Page } from '@playwright/test'
import { readStore, readStores, writeStores } from './fixtures/db'
import { answerPermission, attachSyncHandle, readSyncFile, setPermissionAnswer, stubFilePermission } from './fixtures/sync-file'

/**
 * The launch question: an attached sync file whose handle needs the
 * browser's permission again (after a browser restart) is asked about
 * before anything else — the app waits over the start screen until the user
 * grants access or continues without the file. The handle is a real OPFS
 * file stored where the app keeps its handle; `stubFilePermission` makes it
 * report `prompt` until the app's request is granted, as after a restart.
 */

const SYNC_FILE = 'e2e-launch.json'
const DAY = 86_400_000

type PermissionWindow = Window & { __e2ePermissionRequests?: number }

async function schemaVersion(page: Page): Promise<number> {
  return page.evaluate(async (url) => {
    const mod = (await import(/* @vite-ignore */ url)) as { CURRENT_DB_VERSION: number }
    return mod.CURRENT_DB_VERSION
  }, '/src/data/database.ts')
}

/**
 * A booted app with an old completed task and a 30-day retention (so launch
 * has a purge prompt to show), no backups yet (so launch takes its automatic
 * one), and the sync file attached — holding this browser's data, or the
 * same data with every task renamed (`differ`). Returns the file's text.
 */
async function setUp(page: Page, { differ = false } = {}): Promise<string> {
  await stubFilePermission(page)
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  // The first start's automatic backup has landed before the backups are cleared.
  await expect.poll(async () => (await readStore(page, 'backups')).length).toBeGreaterThan(0)
  const old = new Date(Date.now() - 90 * DAY)
  await writeStores(page, {
    clear: ['backups'],
    add: { todos: [{ uid: crypto.randomUUID(), title: 'Old done task', isCompleted: true, createdAt: old, modifiedAt: old, completedAt: old, sortOrder: 0 }] },
    put: { settings: [{ key: 'completedRetentionDays', value: '30' }] },
  })
  const data = JSON.parse(JSON.stringify(await readStores(page))) as Record<string, Array<Record<string, unknown>>>
  delete data.backups
  if (differ) data.todos = (data.todos ?? []).map((t) => ({ ...t, title: `File: ${String(t.title)}` }))
  const text = JSON.stringify({ ...data, __schemaVersion: await schemaVersion(page), savedAt: new Date().toISOString() })
  await attachSyncHandle(page, SYNC_FILE, text)
  return text
}

const launchQuestion = (page: Page) => page.getByRole('dialog', { name: `Allow access to ${SYNC_FILE}` })
const purgePrompt = (page: Page) => page.getByRole('dialog', { name: 'Delete 1 old completed task?' })

/** Whether the stores launch loads have loaded (read from the app's own module instances). */
async function storesLoaded(page: Page): Promise<{ people: boolean; tags: boolean; todos: boolean }> {
  return page.evaluate(async () => {
    const people = (await import(/* @vite-ignore */ '/src/stores/person-store.ts')) as { usePersonStore: { getState: () => { loaded: boolean } } }
    const tags = (await import(/* @vite-ignore */ '/src/stores/tag-store.ts')) as { useTagStore: { getState: () => { loaded: boolean } } }
    const todos = (await import(/* @vite-ignore */ '/src/stores/todo-store.ts')) as { useTodoStore: { getState: () => { loaded: boolean } } }
    return {
      people: people.usePersonStore.getState().loaded,
      tags: tags.useTagStore.getState().loaded,
      todos: todos.useTodoStore.getState().loaded,
    }
  })
}

test('the question waits over the start screen; Continue without the file opens the browser data, sync paused', async ({ page }) => {
  const fileText = await setUp(page)
  await page.reload()

  const question = launchQuestion(page)
  await expect(question).toBeVisible()
  await expect(question).toContainText(`TODO2 syncs your tasks with ${SYNC_FILE}.`)
  const grant = question.getByRole('button', { name: 'Grant access…' })
  const continueWithout = question.getByRole('button', { name: /Continue without the file/ })
  await expect(grant).toBeFocused()

  // Behind it: the start screen — no top bar, no workspace, no data.
  await expect(page.getByTestId('start-screen')).toBeAttached()
  await expect(page.getByTestId('storage-pill')).toHaveCount(0)
  await expect(page.locator('[data-ws-area]')).toHaveCount(0)
  // Focus stays in (the dialog frame): Tab wraps between the two buttons.
  await page.keyboard.press('Tab')
  await expect(continueWithout).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(grant).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(continueWithout).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(grant).toBeFocused()
  // App shortcuts don't reach past it (the palette's; Space would press the focused button).
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: /command palette/i })).toHaveCount(0)

  // Nothing ran on the browser's data: no store loaded, no purge prompt, no backup.
  expect(await storesLoaded(page)).toEqual({ people: false, tags: false, todos: false })
  await expect(purgePrompt(page)).toHaveCount(0)
  expect(await readStore(page, 'backups')).toHaveLength(0)
  expect(await page.evaluate(() => (window as PermissionWindow).__e2ePermissionRequests ?? 0)).toBe(0)

  // Esc = Continue without the file.
  await page.keyboard.press('Escape')
  await expect(question).toBeHidden()
  // Launch goes on: the purge prompt, then automatic backups.
  await expect(purgePrompt(page)).toBeVisible()
  await purgePrompt(page).getByRole('button', { name: 'Not now' }).click()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect.poll(async () => (await readStore(page, 'backups')).length).toBeGreaterThan(0)
  expect(await page.evaluate(() => (window as PermissionWindow).__e2ePermissionRequests ?? 0)).toBe(0)

  // Sync stays paused: an edit is kept as unsynced and never reaches the file.
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Edit without the file')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await readStore<{ title: string }>(page, 'todos')).map((t) => t.title)).toContain('Edit without the file')
  expect(await readSyncFile(page, SYNC_FILE)).toBe(fileText)
  const syncState = JSON.parse(await page.evaluate(() => localStorage.getItem('todo2-file-sync-state')) ?? '{}') as { dirtySince?: string | null }
  expect(syncState.dirtySince).toBeTruthy()

  // Asked again at the next launch.
  await page.reload()
  await expect(launchQuestion(page)).toBeVisible()
})

test('Grant access: waiting for the browser, then the load decision — its prompt shows over the start screen', async ({ page }) => {
  await setUp(page, { differ: true })
  await page.reload()
  const question = launchQuestion(page)
  await expect(question).toBeVisible()

  await setPermissionAnswer(page, 'hold')
  await question.getByRole('button', { name: 'Grant access…' }).click()
  await expect(question.getByRole('status')).toHaveText('Answer the prompt your browser shows to allow access.')
  await expect(question.getByRole('button', { name: 'Waiting for your browser…' })).toBeDisabled()
  await expect(question.getByRole('button', { name: /Continue without the file/ })).toBeEnabled()

  await answerPermission(page, 'granted')
  await expect(question).toBeHidden()
  // The two sides differ: the usual prompt, still over the start screen.
  const conflict = page.getByRole('dialog', { name: 'Browser data and sync file differ' })
  await expect(conflict).toBeVisible()
  await expect(page.locator('[data-ws-area]')).toHaveCount(0)
  await expect(purgePrompt(page)).toHaveCount(0)
  expect(await storesLoaded(page)).toMatchObject({ people: false, todos: false })

  await conflict.getByRole('radio', { name: new RegExp(SYNC_FILE.replace('.', '\\.')) }).check()
  await conflict.getByRole('button', { name: `Keep ${SYNC_FILE}` }).click()
  // Launch goes on with the file's data; its old completed task is asked about.
  await expect(purgePrompt(page)).toBeVisible()
  await expect(purgePrompt(page)).toContainText('File: Old done task')
  await purgePrompt(page).getByRole('button', { name: 'Not now' }).click()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  expect((await readStore<{ title: string }>(page, 'todos')).map((t) => t.title)).toEqual(['File: Old done task'])
})

test('refused: the question says so and stays; Try again grants and loads', async ({ page }) => {
  await setUp(page)
  await page.reload()
  const question = launchQuestion(page)
  await expect(question).toBeVisible()

  await setPermissionAnswer(page, 'denied')
  await question.getByRole('button', { name: 'Grant access…' }).click()
  await expect(question.getByRole('alert')).toContainText('Your browser didn’t allow access.')
  const retry = question.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeFocused()
  expect(await storesLoaded(page)).toMatchObject({ people: false, todos: false })

  await setPermissionAnswer(page, 'granted')
  await page.keyboard.press('Enter')
  await expect(question).toBeHidden()
  // The file holds this browser's data: it loads without a prompt.
  await expect(purgePrompt(page)).toBeVisible()
  await purgePrompt(page).getByRole('button', { name: 'Not now' }).click()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })

  // Granted for this session: a reload doesn't ask (once the start's own
  // writes reached the file, so the browser isn't left with unsaved changes).
  await expect.poll(async () => (JSON.parse(await page.evaluate(() => localStorage.getItem('todo2-file-sync-state')) ?? '{}') as { dirtySince?: string | null }).dirtySince)
    .toBeNull()
  await readSyncFile(page, SYNC_FILE)
  await page.reload()
  await expect(purgePrompt(page)).toBeVisible()
  await expect(launchQuestion(page)).toHaveCount(0)
})

test('phone: the same question, the answers as two stacked full-width buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await setUp(page)
  await page.reload()
  const question = launchQuestion(page)
  await expect(question).toBeVisible()
  const grant = question.getByRole('button', { name: 'Grant access…' })
  const continueWithout = question.getByRole('button', { name: 'Continue without the file' })
  const g = (await grant.boundingBox())!
  const c = (await continueWithout.boundingBox())!
  expect(g.y + g.height).toBeLessThanOrEqual(c.y)
  expect(Math.round(g.width)).toBe(Math.round(c.width))
  expect(g.height).toBeGreaterThanOrEqual(44)
  const box = (await question.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(15)
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 15)

  await continueWithout.click()
  await expect(purgePrompt(page)).toBeVisible()
})
