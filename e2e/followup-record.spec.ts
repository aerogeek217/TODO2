import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Recording a follow-up from a row means "I followed up today": every way
 * to record one stamps the last follow-up now and moves the next one to
 * today + the default interval (1 month) — never the planned date. Covers
 * the row's follow-up pill (planned and late), the empty-slot flag, the
 * task menu, the bulk bar's ⋯ More and its follow-up popover, a dashboard
 * Needs follow-up row and the phone row. (There is no keyboard shortcut for
 * it; the check-in reply's Record a follow-up is in `checkin-import.spec`.)
 * The popover opened from a row's pill or flag, or the bulk bar, opens with
 * focus on **Followed up**, so ⏎ records; the Next follow-up field still
 * edits the date when clicked, and Esc / a pick hand focus back.
 *
 * The clock is pinned to Sat 10 Oct 2026 15:30.
 */

const NOW = new Date(2026, 9, 10, 15, 30)
const RECORDED = { last: '2026-10-10 15:30', next: '2026-11-10 00:00' }

interface TodoRow { title: string; nextFollowupAt?: Date; lastFollowupAt?: Date }
interface TodoStoreModule { useTodoStore: { getState(): { todos: TodoRow[] } } }

/** The stored follow-up dates for `title`, as local `YYYY-MM-DD HH:mm` strings (or null). */
async function followupOf(page: Page, title: string): Promise<{ next: string | null; last: string | null }> {
  return page.evaluate(async ({ url, title }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const t = mod.useTodoStore.getState().todos.find((x) => x.title === title)
    const fmt = (d?: Date) => {
      if (!d) return null
      const x = new Date(d)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`
    }
    return { next: fmt(t?.nextFollowupAt), last: fmt(t?.lastFollowupAt) }
  }, { url: '/src/stores/todo-store.ts', title })
}

const popover = (page: Page) => page.getByRole('dialog', { name: 'Follow-up' })
const rowIn = (scope: Locator, title: string) => scope.locator('[data-todo-id]').filter({ hasText: title })
const titleIn = (scope: Locator, title: string) => rowIn(scope, title).locator(`span[data-task-title="${title}"]`)

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'All' }],
  tasks: [
    { title: 'Planned pill', followupInDays: 3 },
    { title: 'Late pill', followupInDays: -2 },
    { title: 'No follow-up yet' },
    { title: 'From the menu', followupInDays: 5 },
    { title: 'Bulk one', followupInDays: 10 },
    { title: 'Bulk two', followupInDays: 12 },
    { title: 'Bulk pop one', followupInDays: 20 },
    { title: 'Bulk pop two', followupInDays: 21 },
    { title: 'Dashboard late', followupInDays: -4 },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', weight: 2, cells: [{ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'c2', weight: 2, cells: [{ id: 'k2', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { tiles: [], sections: [{ id: 'followup' }] } }] }] },
    ],
  }],
}

test.describe('recording a follow-up from a row stamps today', () => {
  test.use({ viewport: { width: 1600, height: 1000 } })

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await seedWorkspace(page, SEED)
  })

  test('the pill (planned and late), the empty-slot flag and the task menu', async ({ page }) => {
    const list = page.locator('[data-list-widget="list"]')

    // The pill of a planned follow-up → the popover's Followed up.
    await rowIn(list, 'Planned pill').getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    await popover(page).getByRole('button', { name: /^Followed up/ }).click()
    await expect.poll(() => followupOf(page, 'Planned pill')).toEqual(RECORDED)

    // A late follow-up's pill.
    await rowIn(list, 'Late pill').getByRole('button', { name: /^Follow-up: Thu 8/ }).click()
    await popover(page).getByRole('button', { name: /^Followed up/ }).click()
    await expect.poll(() => followupOf(page, 'Late pill')).toEqual(RECORDED)

    // The empty-slot flag of a task with no follow-up.
    const flagRow = rowIn(list, 'No follow-up yet')
    await flagRow.hover()
    await flagRow.getByRole('button', { name: 'Set follow-up', exact: true }).click()
    await popover(page).getByRole('button', { name: /^Followed up/ }).click()
    await expect.poll(() => followupOf(page, 'No follow-up yet')).toEqual(RECORDED)

    // The task menu (right-click).
    await titleIn(list, 'From the menu').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Followed up' }).click()
    await expect.poll(() => followupOf(page, 'From the menu')).toEqual(RECORDED)
  })

  test('the bulk bar: ⋯ More › Followed up, and its follow-up popover', async ({ page }) => {
    const list = page.locator('[data-list-widget="list"]')
    const bulkBar = page.getByTestId('list-bulk-bar')

    await titleIn(list, 'Bulk one').click()
    await titleIn(list, 'Bulk two').click({ modifiers: ['Control'] })
    await bulkBar.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: /^Followed up/ }).click()
    await expect.poll(() => followupOf(page, 'Bulk one')).toEqual(RECORDED)
    await expect.poll(() => followupOf(page, 'Bulk two')).toEqual(RECORDED)

    await titleIn(list, 'Bulk pop one').click()
    await titleIn(list, 'Bulk pop two').click({ modifiers: ['Control'] })
    await bulkBar.getByRole('button', { name: 'Set follow-up', exact: true }).click()
    await popover(page).getByRole('button', { name: /^Followed up/ }).click()
    await expect.poll(() => followupOf(page, 'Bulk pop one')).toEqual(RECORDED)
    await expect.poll(() => followupOf(page, 'Bulk pop two')).toEqual(RECORDED)
  })

  test('the popover opens on Followed up: ⏎ records today and focus goes back to the pill', async ({ page }) => {
    const list = page.locator('[data-list-widget="list"]')
    await rowIn(list, 'Planned pill').getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    const followedUp = popover(page).getByRole('button', { name: /^Followed up/ })
    await expect(followedUp).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    await expect.poll(() => followupOf(page, 'Planned pill')).toEqual(RECORDED)
    await expect(rowIn(list, 'Planned pill').getByRole('button', { name: 'Follow-up: Tue 10 Nov', exact: true })).toBeFocused()
  })

  test('the empty-slot flag opens on Followed up too; Esc closes with nothing changed and gives the flag its focus back', async ({ page }) => {
    const list = page.locator('[data-list-widget="list"]')
    const row = rowIn(list, 'No follow-up yet')
    await row.hover()
    const flag = row.getByRole('button', { name: 'Set follow-up', exact: true })
    await flag.click()
    await expect(popover(page).getByRole('button', { name: /^Followed up/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(flag).toBeFocused()
    await expect.poll(() => followupOf(page, 'No follow-up yet')).toEqual({ next: null, last: null })
  })

  test('clicking into Next follow-up still edits the next date', async ({ page }) => {
    const list = page.locator('[data-list-widget="list"]')
    await rowIn(list, 'Planned pill').getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    const input = popover(page).getByRole('textbox', { name: 'Next follow-up' })
    await input.click()
    await input.fill('2w')
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeHidden()
    await expect.poll(() => followupOf(page, 'Planned pill')).toEqual({ next: '2026-10-24 00:00', last: null })
  })

  test('the bulk bar follow-up popover opens on Followed up: ⏎ records today for every selected task', async ({ page }) => {
    const list = page.locator('[data-list-widget="list"]')
    await titleIn(list, 'Bulk pop one').click()
    await titleIn(list, 'Bulk pop two').click({ modifiers: ['Control'] })
    await page.getByTestId('list-bulk-bar').getByRole('button', { name: 'Set follow-up', exact: true }).click()
    await expect(popover(page).getByRole('button', { name: /^Followed up/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => followupOf(page, 'Bulk pop one')).toEqual(RECORDED)
    await expect.poll(() => followupOf(page, 'Bulk pop two')).toEqual(RECORDED)
  })

  test('a dashboard Needs follow-up row', async ({ page }) => {
    const dash = page.locator('[data-dashboard="dash"]')
    await rowIn(dash, 'Dashboard late').getByRole('button', { name: /^Follow-up: Tue 6/ }).click()
    await popover(page).getByRole('button', { name: /^Followed up/ }).click()
    await expect.poll(() => followupOf(page, 'Dashboard late')).toEqual(RECORDED)
  })
})

test.describe('the phone row', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('its follow-up pill → Followed up stamps today', async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await seedWorkspace(page, { ...SEED, tasks: [{ title: 'Planned pill', followupInDays: 3 }] })
    const row = page.locator('[data-todo-id]').filter({ hasText: 'Planned pill' }).first()
    await row.getByRole('button', { name: /^Follow-up:/ }).click()
    // Opens on Followed up, as on desktop.
    const followedUp = popover(page).getByRole('button', { name: /^Followed up/ })
    await expect(followedUp).toBeFocused()
    await followedUp.click()
    await expect.poll(() => followupOf(page, 'Planned pill')).toEqual(RECORDED)
  })
})
