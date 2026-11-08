import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsRow } from './fixtures/workspace'

/**
 * Clearing the next follow-up in the popover sticks: its × clears the stored
 * date at once, however the popover then closes, and the field stays empty —
 * it doesn't fill back up with the automatic date, which Mark followed up
 * would then write. The clock is pinned to Sat 10 Oct 2026 15:30; Settings'
 * automatic next follow-up is on (1 month).
 */

const NOW = new Date(2026, 9, 10, 15, 30)

const popover = (page: Page) => page.getByRole('dialog', { name: 'Follow-up' })
const field = (page: Page) => popover(page).getByRole('textbox', { name: 'Next follow-up' })
const clear = (page: Page) => popover(page).getByRole('button', { name: 'Clear next follow-up', exact: true })
const followedUp = (page: Page) => popover(page).getByRole('button', { name: /^Mark followed up/ })
const row = (page: Page, title: string) => page.locator('[data-list-widget="list"] [data-todo-id]').filter({ hasText: title })

interface TodoStoreModule { useTodoStore: { getState(): { todos: { title: string; nextFollowupAt?: Date; lastFollowupAt?: Date }[] } } }

/** Whether the task has each date, read in the page (its pinned clock's Dates don't cross back). */
async function has(page: Page, title: string): Promise<{ next: boolean; last: boolean }> {
  return page.evaluate(async ({ url, title }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const t = mod.useTodoStore.getState().todos.find((x) => x.title === title)
    return { next: !!t?.nextFollowupAt, last: !!t?.lastFollowupAt }
  }, { url: '/src/stores/todo-store.ts', title })
}

test.describe('clearing the next follow-up in the popover', () => {
  test.use({ viewport: { width: 1400, height: 800 } })

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'All' }],
      tasks: [{ title: 'Later', followupInDays: 3 }, { title: 'Overdue', followupInDays: -2 }],
      layouts: [{ name: 'Main', columns: [{ id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] }] }],
    })
  })

  for (const [how, close] of [
    ['Esc', (page: Page) => page.keyboard.press('Escape')],
    ['an outside click', (page: Page) => page.mouse.click(5, 700)],
  ] as const) {
    test(`× then ${how}: the date is gone`, async ({ page }) => {
      await row(page, 'Later').getByRole('button', { name: /^Follow-up:/ }).click()
      await clear(page).click()
      await expect(field(page)).toHaveValue('')
      await close(page)
      await expect(popover(page)).toBeHidden()
      await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: false })
      await expect(row(page, 'Later').getByRole('button', { name: /^Follow-up:/ })).toHaveCount(0)
    })
  }

  test('× on a late date, where the field shows the automatic one: the stored date is gone too', async ({ page }) => {
    await row(page, 'Overdue').getByRole('button', { name: /^Follow-up:/ }).click()
    await expect(field(page)).toHaveValue('Tue 10 Nov')
    await clear(page).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => has(page, 'Overdue')).toEqual({ next: false, last: false })
  })

  test('× then Mark followed up, twice: the field stays empty and no date comes back', async ({ page }) => {
    await row(page, 'Later').getByRole('button', { name: /^Follow-up:/ }).click()
    await clear(page).click()
    await followedUp(page).click()
    await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: true })
    await expect(field(page)).toHaveValue('')
    await followedUp(page).click()
    await expect(field(page)).toHaveValue('')
    await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: true })
  })

  test('× then ⏎: closes, with no date', async ({ page }) => {
    await row(page, 'Later').getByRole('button', { name: /^Follow-up:/ }).click()
    await clear(page).click()
    await expect(field(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: false })
  })

  test('the text deleted by hand: the help line says ⏎ clears; ⏎ then ⏎ on Mark followed up leaves no date', async ({ page }) => {
    await row(page, 'Later').getByRole('button', { name: /^Follow-up:/ }).click()
    await field(page).click()
    await page.keyboard.press('Delete')
    await expect(popover(page).getByText('No next follow-up · ⏎ to clear')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: false })
    await expect(field(page)).toHaveValue('')
    await expect(followedUp(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: true })
    await expect(field(page)).toHaveValue('')
  })

  test('Undo after × brings the date back', async ({ page }) => {
    await row(page, 'Later').getByRole('button', { name: /^Follow-up:/ }).click()
    await clear(page).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => has(page, 'Later')).toEqual({ next: false, last: false })
    await page.keyboard.press('Control+z')
    await expect.poll(() => has(page, 'Later')).toEqual({ next: true, last: false })
  })
})
