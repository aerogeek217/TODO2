import { expect, test, type Locator, type Page } from '@playwright/test'
import { selectTaskRowByTitle, taskRowByTitle } from './fixtures/seed'
import { seedTaskList, TASK_LIST_TAB, wsListWidget } from './fixtures/workspace'
import { clickOutside } from './fixtures/geometry'

/**
 * Inline title editing on `TaskRow` (`useInlineEdit`). Focus handoff into the
 * edit box and blur-to-save are real-browser behaviors (JSDOM isn't
 * authoritative for focus), so the commit/cancel paths are locked in here.
 *
 * The edit box's value is derived (`draft ?? title`): while the
 * box is open but untouched it tracks the live title, so an external rename
 * followed by blur must not write the stale title back.
 */

interface TodoStoreModule {
  useTodoStore: {
    getState(): {
      todos: Array<{ id: number; title: string }>
      update(id: number, changes: { title?: string }): Promise<void>
    }
  }
}

/** Same module instance the app uses — Vite dev serves source by URL. */
const TODO_STORE_URL = '/src/stores/todo-store.ts'

async function storeTitle(page: Page, id: number): Promise<string | undefined> {
  return page.evaluate(async ({ url, id }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    return mod.useTodoStore.getState().todos.find((t) => t.id === id)?.title
  }, { url: TODO_STORE_URL, id })
}

/** Rename a todo through the store — the path every other surface uses. */
async function renameExternally(page: Page, id: number, title: string): Promise<void> {
  await page.evaluate(async ({ url, id, title }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const state = mod.useTodoStore.getState()
    const todo = state.todos.find((t) => t.id === id)
    if (!todo) throw new Error(`renameExternally: no todo ${id}`)
    await state.update(todo.id, { title })
  }, { url: TODO_STORE_URL, id, title })
}

/**
 * Select the row, then single-click its title again to enter edit mode
 * (`scheduleEdit` fires after the 250 ms click/double-click window). Returns
 * the todo id and the edit input. The row is re-located by id afterwards
 * because the title span (and its text) is swapped out for the input.
 */
async function startEditing(page: Page, title: string): Promise<{ id: number; input: Locator; row: Locator }> {
  const idAttr = await taskRowByTitle(page, title).locator('[data-todo-id]').first().getAttribute('data-todo-id')
  const id = Number(idAttr)
  await selectTaskRowByTitle(page, title)
  // Selected first: a click on a selected title schedules the edit. (Two
  // separate clicks are never a double-click, which would open the editor.)
  await expect(taskRowByTitle(page, title)).toHaveAttribute('data-selected', 'true')
  await selectTaskRowByTitle(page, title)
  const row = page.locator(`[data-todo-id="${id}"]`)
  const input = row.locator('input[maxlength="500"]')
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(title)
  return { id, input, row }
}

test.describe('TaskRow inline title edit', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }] })
  })

  test('single-click on a selected title focuses the edit box; Enter saves', async ({ page }) => {
    const { id, input } = await startEditing(page, 'alpha')
    await input.fill('alpha renamed')
    await input.press('Enter')
    await expect(input).toHaveCount(0)
    await expect(taskRowByTitle(page, 'alpha renamed')).toBeVisible()
    await expect.poll(() => storeTitle(page, id)).toBe('alpha renamed')

    // Persisted to IndexedDB, not just the store.
    await page.reload()
    await expect(taskRowByTitle(page, 'alpha renamed')).toBeVisible()
  })

  test('Escape reverts without saving', async ({ page }) => {
    const { id, input } = await startEditing(page, 'alpha')
    await input.fill('discarded')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(taskRowByTitle(page, 'alpha')).toBeVisible()
    expect(await storeTitle(page, id)).toBe('alpha')
  })

  test('blur (click elsewhere) saves', async ({ page }) => {
    const { id, input } = await startEditing(page, 'alpha')
    await input.fill('alpha via blur')
    await clickOutside(page, wsListWidget(page, TASK_LIST_TAB))
    await expect(input).toHaveCount(0)
    await expect.poll(() => storeTitle(page, id)).toBe('alpha via blur')
    await expect(taskRowByTitle(page, 'alpha via blur')).toBeVisible()
  })

  test('an external rename while the box is open and untouched is not reverted on blur', async ({ page }) => {
    const { id, input } = await startEditing(page, 'alpha')

    await renameExternally(page, id, 'renamed elsewhere')
    // Untouched draft follows the live title.
    await expect(input).toHaveValue('renamed elsewhere')

    await clickOutside(page, wsListWidget(page, TASK_LIST_TAB))
    await expect(input).toHaveCount(0)
    await expect(taskRowByTitle(page, 'renamed elsewhere')).toBeVisible()
    // A blur save writes the store at once (optimistic), so a wrong one would show here.
    expect(await storeTitle(page, id)).toBe('renamed elsewhere')
    await page.reload()
    await expect(taskRowByTitle(page, 'renamed elsewhere')).toBeVisible()
  })
})
