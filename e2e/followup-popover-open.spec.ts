import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * The follow-up popover stays open across a date and a Mark followed up — the
 * two are often done together — even when the write takes the row out of its
 * list, and whatever scroll the list makes because of it. The keyboard goes
 * date ⏎, Mark followed up ⏎, close ⏎ in either order. The clock is pinned to
 * Sat 10 Oct 2026 15:30; Settings' automatic next follow-up is on (1 month).
 */

const NOW = new Date(2026, 9, 10, 15, 30)

const popover = (page: Page) => page.getByRole('dialog', { name: 'Follow-up' })
const field = (page: Page) => popover(page).getByRole('textbox', { name: 'Next follow-up' })
const followedUp = (page: Page) => popover(page).getByRole('button', { name: /^Mark followed up/ })
const list = (page: Page) => page.locator('[data-list-widget="list"]')
const rowOf = (page: Page, title: string) => list(page).locator('[data-todo-id]').filter({ hasText: title })

interface TodoStoreModule { useTodoStore: { getState(): { todos: { title: string; nextFollowupAt?: Date; lastFollowupAt?: Date }[] } } }

/** The stored dates as numbers, read in the page (its pinned clock's Dates don't cross back). */
async function stored(page: Page, title: string): Promise<{ next?: number; last?: number }> {
  return page.evaluate(async ({ url, title }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const t = mod.useTodoStore.getState().todos.find((x) => x.title === title)
    return { next: t?.nextFollowupAt ? +new Date(t.nextFollowupAt) : undefined, last: t?.lastFollowupAt ? +new Date(t.lastFollowupAt) : undefined }
  }, { url: '/src/stores/todo-store.ts', title })
}

const layouts: WorkspaceSeed['layouts'] = [
  { name: 'Main', columns: [{ id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] }] },
]

test.describe('the follow-up popover stays open', () => {
  test.use({ viewport: { width: 1400, height: 700 } })
  test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(NOW) })

  test('the keyboard: ⏎ records, then a date ⏎, then ⏎ closes and focus goes back to the pill', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'All' }],
      tasks: [{ title: 'Quote', followupInDays: 3 }],
      layouts,
    })
    const pill = rowOf(page, 'Quote').getByRole('button', { name: /^Follow-up:/ })
    await pill.click()
    await expect(followedUp(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await stored(page, 'Quote')).last).toBe(NOW.getTime())
    await expect(popover(page).getByText(/^Last followed up/)).toContainText('Sat 10 Oct')

    // On to the date: its text selected, so typing replaces it.
    await expect(field(page)).toBeFocused()
    await page.keyboard.type('2w')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await stored(page, 'Quote')).next).toBe(new Date(2026, 9, 24).getTime())
    await expect(popover(page)).toBeVisible()
    await expect(field(page)).toHaveValue('Sat 24 Oct')

    await expect(field(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    await expect(pill).toBeFocused()
  })

  test('the keyboard: a date ⏎ goes on to Mark followed up, ⏎ records', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'All' }],
      tasks: [{ title: 'Quote', followupInDays: -2 }],
      layouts,
    })
    await rowOf(page, 'Quote').getByRole('button', { name: /^Follow-up:/ }).click()
    await field(page).click()
    await page.keyboard.type('2w')
    await page.keyboard.press('Enter')
    await expect(followedUp(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => stored(page, 'Quote')).toEqual({ next: new Date(2026, 9, 24).getTime(), last: NOW.getTime() })
    await expect(popover(page)).toBeVisible()
  })

  test('the row leaves its list: the popover stays where it was and still acts on the task', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'No next follow-up', predicate: { dates: { followup: { match: 'unset' } } } }],
      tasks: [{ title: 'Chase invoice' }, { title: 'Stays behind' }],
      layouts,
    })
    await rowOf(page, 'Chase invoice').getByRole('button', { name: 'Set follow-up' }).click()
    await expect(popover(page)).toBeVisible()
    const opened = await popover(page).boundingBox()

    // Mark followed up gives it the automatic next follow-up: out of this list.
    await followedUp(page).click()
    await expect(rowOf(page, 'Chase invoice')).toHaveCount(0)
    await expect(popover(page)).toBeVisible()
    expect((await popover(page).boundingBox())?.x).toBe(opened?.x)
    await expect(field(page)).toHaveValue('Tue 10 Nov')

    // The date still goes to the task.
    await popover(page).getByRole('button', { name: 'Follow up in 1 week' }).click()
    await expect.poll(async () => (await stored(page, 'Chase invoice')).next).toBe(new Date(2026, 9, 17).getTime())
    await expect(field(page)).toHaveValue('Sat 17 Oct')

    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
  })

  test('the list shrinks and clamps its scroll: that doesn’t close it; the wheel does', async ({ page }) => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({ title: `Task ${String(i).padStart(2, '0')}` }))
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'No next follow-up', predicate: { dates: { followup: { match: 'unset' } } } }],
      tasks,
      layouts,
    })
    const last = rowOf(page, 'Task 59')
    await last.scrollIntoViewIfNeeded()
    await last.getByRole('button', { name: 'Set follow-up' }).click()
    await followedUp(page).click()
    await expect(rowOf(page, 'Task 59')).toHaveCount(0)
    await expect(popover(page)).toBeVisible()

    // A second one, its row gone too: the offset is at its limit again.
    await page.keyboard.press('Escape')
    const next = rowOf(page, 'Task 58')
    await next.scrollIntoViewIfNeeded()
    await next.getByRole('button', { name: 'Set follow-up' }).click()
    await followedUp(page).click()
    await expect(rowOf(page, 'Task 58')).toHaveCount(0)
    await expect(popover(page)).toBeVisible()

    const box = await list(page).boundingBox()
    await page.mouse.move((box?.x ?? 0) + 50, (box?.y ?? 0) + 80)
    await page.mouse.wheel(0, -200)
    await expect(popover(page)).toBeHidden()
  })
})
