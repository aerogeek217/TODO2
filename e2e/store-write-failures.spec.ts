import { expect, test, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * Task writes that fail: the change is taken back, the snackbar says so, and
 * nothing is left as an unhandled rejection. An undo that fails stays on the
 * undo stack, so the next undo tries it again.
 *
 * A failed write is simulated in the page: while `window.__e2eFailTodoWrites`
 * is set, every write to the `todos` object store aborts its transaction, so
 * the app's own write fails for real.
 */

test.use({ viewport: { width: 1280, height: 800 } })


async function installTodoWriteFailureSwitch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eFailTodoWrites?: boolean }
    const failing = (store: IDBObjectStore) => store.name === 'todos' && w.__e2eFailTodoWrites === true
    for (const method of ['add', 'put', 'delete'] as const) {
      const original = IDBObjectStore.prototype[method] as (...args: unknown[]) => IDBRequest
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
        const req = original.apply(this, args)
        if (failing(this)) this.transaction.abort()
        return req
      } as never
    }
    for (const method of ['update', 'delete'] as const) {
      const original = IDBCursor.prototype[method] as (...args: unknown[]) => IDBRequest
      IDBCursor.prototype[method] = function (this: IDBCursor, ...args: unknown[]) {
        const req = original.apply(this, args)
        const store = this.source instanceof IDBIndex ? this.source.objectStore : this.source as IDBObjectStore
        if (failing(store)) store.transaction.abort()
        return req
      } as never
    }
  })
}

async function failTodoWrites(page: Page, on: boolean) {
  await page.evaluate((v) => { (window as unknown as { __e2eFailTodoWrites?: boolean }).__e2eFailTodoWrites = v }, on)
}

async function dbTitles(page: Page): Promise<string[]> {
  return (await readStore<{ title: string }>(page, 'todos')).map((t) => t.title).sort()
}

/** Errors the page didn't handle (an unhandled rejection shows up here too). */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => { errors.push(e.message) })
  return errors
}

test('a task edit that fails is taken back and the snackbar says so', async ({ page }) => {
  await installTodoWriteFailureSwitch(page)
  const errors = collectPageErrors(page)
  await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }] })

  await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
  const title = page.getByRole('textbox', { name: 'Task title' })
  await title.click()
  await title.press('End')
  await page.keyboard.type(' renamed')
  await expect(title).toHaveValue('alpha renamed')

  await failTodoWrites(page, true)
  // Leaving the field saves the title.
  await page.keyboard.press('Escape')
  await expect(title).not.toBeFocused()
  await expect(page.getByText('Couldn\'t save your change to "alpha".')).toBeVisible()
  await failTodoWrites(page, false)

  await page.keyboard.press('Escape')
  await expect(title).toBeHidden()
  await expect(taskRowByTitle(page, 'alpha')).toBeVisible()
  await expect(taskRowByTitle(page, 'alpha renamed')).toHaveCount(0)
  expect(await dbTitles(page)).toEqual(['alpha', 'beta'])
  expect(errors).toEqual([])
})

test('an undo that fails says so and stays undoable; the next undo brings the task back', async ({ page }) => {
  await installTodoWriteFailureSwitch(page)
  const errors = collectPageErrors(page)
  await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }] })

  await selectTaskRowByTitle(page, 'alpha')
  await expect(page.locator('[data-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('Delete')
  await page.getByRole('dialog', { name: 'Delete task' }).getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(taskRowByTitle(page, 'alpha')).toHaveCount(0)
  const undoButton = page.getByRole('button', { name: 'Undo' })
  await expect(undoButton).toBeVisible()

  await failTodoWrites(page, true)
  await undoButton.click()
  await expect(page.getByText('Couldn\'t undo: Delete "alpha"')).toBeVisible()
  await expect(taskRowByTitle(page, 'alpha')).toHaveCount(0)
  expect(await dbTitles(page)).toEqual(['beta'])

  await failTodoWrites(page, false)
  await page.keyboard.press('Control+z')
  await expect(taskRowByTitle(page, 'alpha')).toBeVisible()
  expect(await dbTitles(page)).toEqual(['alpha', 'beta'])
  expect(errors).toEqual([])
})

test('a create that fails keeps Quick Add and the task editor open as typed; trying again creates the task', async ({ page }) => {
  await installTodoWriteFailureSwitch(page)
  const errors = collectPageErrors(page)
  await seedTaskList(page, { tasks: [{ title: 'alpha' }] })

  // Quick Add: the bar stays open with the text.
  await failTodoWrites(page, true)
  await page.keyboard.press('Control+Space')
  const bar = page.getByRole('dialog', { name: 'Quick add task' })
  const input = bar.getByPlaceholder('New task…')
  await input.fill('Call the plumber')
  await input.press('Enter')
  await expect(page.getByText('Couldn\'t add "Call the plumber".')).toBeVisible()
  await expect(bar).toBeVisible()
  await expect(input).toHaveValue('Call the plumber')

  // Details ⇥: the editor too stays open with every field as typed.
  await input.press('Tab')
  await expect(bar).toBeHidden()
  const title = page.getByPlaceholder('New task… (@person #tag /command)')
  await expect(title).toHaveValue('Call the plumber')
  const progress = page.getByPlaceholder('e.g. 50% done, Waiting on review...')
  await progress.fill('Quote asked')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByText('Couldn\'t add "Call the plumber".')).toBeVisible()
  await expect(title).toHaveValue('Call the plumber')
  await expect(progress).toHaveValue('Quote asked')
  expect(await dbTitles(page)).toEqual(['alpha'])

  await failTodoWrites(page, false)
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect(title).toBeHidden()
  await expect(taskRowByTitle(page, 'Call the plumber')).toBeVisible()
  expect(await dbTitles(page)).toEqual(['Call the plumber', 'alpha'])
  expect(errors).toEqual([])
})
