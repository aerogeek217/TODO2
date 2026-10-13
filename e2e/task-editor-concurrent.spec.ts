import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * The task editor while its task changes elsewhere. Real-browser because it
 * hinges on focus: the title is being typed (focused, unsaved) when the
 * change lands, and it saves on blur.
 */

interface TodoRow { id: number; title: string; dueDate?: Date; statusId?: number }
interface TodoStoreModule {
  useTodoStore: {
    getState(): {
      todos: TodoRow[]
      bulkSetDeadline(ids: number[], date: Date | null): Promise<void>
    }
  }
}

/** Same module instance the app uses — Vite dev serves source by URL. */
const TODO_STORE_URL = '/src/stores/todo-store.ts'

/** A bulk due-date change on the given tasks, as the bulk bar makes it. */
async function bulkSetDue(page: Page, titles: string[], date: [number, number, number]): Promise<void> {
  await page.evaluate(async ({ url, titles, date }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const state = mod.useTodoStore.getState()
    const ids = state.todos.filter((t) => titles.includes(t.title)).map((t) => t.id)
    await state.bulkSetDeadline(ids, new Date(date[0], date[1], date[2]))
  }, { url: TODO_STORE_URL, titles, date })
}

async function storedTask(page: Page, title: string): Promise<{ title: string; due: string | null } | null> {
  return page.evaluate(async ({ url, title }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const t = mod.useTodoStore.getState().todos.find((x) => x.title === title)
    return t ? { title: t.title, due: t.dueDate ? new Date(t.dueDate).toDateString() : null } : null
  }, { url: TODO_STORE_URL, title })
}

test('a title typed in the editor survives a bulk due-date change; saving keeps that change', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }] })
  await taskRowByTitle(page, 'alpha').locator('span[title="alpha"]').dblclick()
  const title = page.getByRole('textbox', { name: 'Task title' })
  await title.click()
  await title.press('End')
  await page.keyboard.type(' renamed')
  await expect(title).toHaveValue('alpha renamed')

  // The change lands while the title is focused and unsaved.
  await bulkSetDue(page, ['alpha', 'beta'], [2026, 11, 24])
  await expect(page.getByTitle(/^Due: /)).toBeVisible()
  await expect(title).toBeFocused()
  await expect(title).toHaveValue('alpha renamed')

  // Keep typing, then leave the field: the title saves, the due date stays.
  await page.keyboard.type('!')
  await page.keyboard.press('Escape')
  await expect(title).not.toBeFocused()
  await expect.poll(() => storedTask(page, 'alpha renamed!')).toEqual({
    title: 'alpha renamed!',
    due: new Date(2026, 11, 24).toDateString(),
  })
  expect(await storedTask(page, 'beta')).toEqual({ title: 'beta', due: new Date(2026, 11, 24).toDateString() })
})
