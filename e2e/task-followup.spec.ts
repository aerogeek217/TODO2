import { expect, test, type Locator, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList, TASK_LIST_TAB, wsListWidget } from './fixtures/workspace'

/**
 * Follow-up pill, empty-slot flag, follow-up popover and the editor's
 * Follow-up group in a real browser: hover reveal, popover anchoring inside
 * the viewport, focus on open, keyboard apply / dismiss, one-click clear, the
 * "Followed up" undo snackbar, and Tab-commit in the task editor. JSDOM is not
 * authoritative for any of these.
 *
 * The clock is pinned to Sat 10 Oct 2026 15:30 so labels are stable.
 */

const NOW = new Date(2026, 9, 10, 15, 30)

interface TodoRow { id: number; title: string; nextFollowupAt?: Date; lastFollowupAt?: Date }
interface TodoStoreModule {
  useTodoStore: {
    getState(): {
      todos: TodoRow[]
      update(id: number, changes: Partial<TodoRow>): Promise<void>
    }
  }
}
const TODO_STORE_URL = '/src/stores/todo-store.ts'

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
  }, { url: TODO_STORE_URL, title })
}

async function setNextFollowup(page: Page, title: string, y: number, m: number, d: number): Promise<void> {
  await page.evaluate(async ({ url, title, y, m, d }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const state = mod.useTodoStore.getState()
    const todo = state.todos.find((x) => x.title === title)
    if (!todo) throw new Error(`no todo ${title}`)
    await state.update(todo.id, { nextFollowupAt: new Date(y, m - 1, d) })
  }, { url: TODO_STORE_URL, title, y, m, d })
}

const popover = (page: Page) => page.getByRole('dialog', { name: 'Follow-up' })

async function expectInViewport(page: Page, el: Locator): Promise<void> {
  const box = await el.boundingBox()
  const vp = page.viewportSize()
  if (!box || !vp) throw new Error('no box / viewport')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
}

test.describe('Task follow-up', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await seedTaskList(page, { tasks: [{ title: 'alpha' }, { title: 'beta' }] })
  })

  test('empty follow-up cell: its flag shows on hover (the cell keeps its place), opens the popover on Followed up; typing an interval in the field + Enter sets it', async ({ page }) => {
    const row = taskRowByTitle(page, 'alpha')
    const flag = row.getByRole('button', { name: 'Set follow-up', exact: true })
    const placeholderOpacity = () => flag.evaluate((el) => Number(getComputedStyle(el.querySelector('[aria-hidden="true"]') as HTMLElement).opacity))
    const at = (await flag.boundingBox())!
    expect(await placeholderOpacity()).toBe(0)
    await row.locator('[data-task-title]').hover()
    await expect.poll(placeholderOpacity).toBe(1)
    expect(await flag.boundingBox()).toEqual(at)
    await flag.click()

    const pop = popover(page)
    await expect(pop).toBeVisible()
    await expectInViewport(page, pop)
    // Anchored to the flag: starts at (or flips above) the flag's edge.
    const fb = (await flag.boundingBox())!
    const pb = (await pop.boundingBox())!
    expect(pb.y >= fb.y + fb.height - 1 || pb.y + pb.height <= fb.y + 1).toBe(true)
    await expect(pop.getByText('Never followed up')).toBeVisible()

    const input = pop.getByRole('textbox', { name: 'Next follow-up' })
    await expect(pop.getByRole('button', { name: /^Mark followed up/ })).toBeFocused()
    await input.click()
    await page.keyboard.type('2w')
    await expect(pop.getByText('Sat 24 Oct')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(pop).toBeHidden()

    await expect(row.getByRole('button', { name: 'Follow-up: Sat 24', exact: true })).toBeVisible()
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-24 00:00', last: null })
    // The other row is untouched.
    await expect.poll(() => followupOf(page, 'beta')).toEqual({ next: null, last: null })
  })

  test('pill: the field shows the value; invalid text shows help; Esc and outside click close without change', async ({ page }) => {
    await setNextFollowup(page, 'alpha', 2026, 10, 13)
    const row = taskRowByTitle(page, 'alpha')
    const pill = row.getByRole('button', { name: 'Follow-up: Tue 13', exact: true })
    await pill.click()
    const pop = popover(page)
    const input = pop.getByRole('textbox', { name: 'Next follow-up' })
    await expect(pop.getByRole('button', { name: /^Mark followed up/ })).toBeFocused()
    await expect(input).toHaveValue('Tue 13 Oct')
    await expect(pop.getByText('in 3 days')).toBeVisible()
    await input.fill('whenever')
    await expect(input).toHaveValue('whenever')
    await expect(pop.getByText('Try 2w, 10d, 1m, fri, 24 Oct or 10/24')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(pop).toBeVisible() // invalid input doesn't apply
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-13 00:00', last: null })

    await pill.click()
    await expect(pop).toBeVisible()
    // Outside: the list widget's empty space below the rows.
    const wb = (await wsListWidget(page, TASK_LIST_TAB).boundingBox())!
    await page.mouse.click(wb.x + wb.width / 2, wb.y + wb.height - 20)
    await expect(pop).toBeHidden()
    await expect(pill).toBeVisible()
  })

  test('quick interval, then "Followed up" with the undo snackbar', async ({ page }) => {
    const row = taskRowByTitle(page, 'alpha')
    await row.hover()
    await row.getByRole('button', { name: 'Set follow-up', exact: true }).click()
    await popover(page).getByRole('button', { name: 'Follow up in 1 week' }).click()
    await expect(popover(page)).toBeHidden()
    const pill = row.getByRole('button', { name: 'Follow-up: Sat 17', exact: true })
    await expect(pill).toBeVisible()

    await pill.click()
    const followedUp = popover(page).getByRole('button', { name: /^Mark followed up/ })
    await expect(followedUp).toHaveAccessibleName('Mark followed up · Next: Tue 11/10')
    await followedUp.click()
    await expect(popover(page)).toBeHidden()
    await expect(row.getByRole('button', { name: 'Follow-up: Tue 10 Nov', exact: true })).toBeVisible()
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-11-10 00:00', last: '2026-10-10 15:30' })

    await expect(page.getByText('Followed up · next follow-up Tue 10 Nov')).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(row.getByRole('button', { name: 'Follow-up: Sat 17', exact: true })).toBeVisible()
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-17 00:00', last: null })
  })

  test('the popover’s × clears the follow-up; the cell goes back to its placeholder', async ({ page }) => {
    await setNextFollowup(page, 'alpha', 2026, 10, 13)
    const row = taskRowByTitle(page, 'alpha')
    await row.getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    await popover(page).getByRole('button', { name: 'Clear follow-up', exact: true }).click()
    await expect(row.getByRole('button', { name: /^Follow-up:/ })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Set follow-up', exact: true })).toBeVisible()
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: null, last: null })
  })

  test('overdue follow-up: the filled flag only ("late" in its accessible name), glowing yellow, not the due-date magenta', async ({ page }) => {
    await setNextFollowup(page, 'alpha', 2026, 10, 8)
    const cell = taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Follow-up: Thu 8, late', exact: true })
    await expect(cell).toHaveAttribute('data-followup', 'late')
    await expect(cell).toHaveText('')
    const { filter, color, fill } = await cell.evaluate((el) => {
      const svg = el.querySelector('svg')!
      return { filter: getComputedStyle(svg).filter, color: getComputedStyle(el).color, fill: svg.getAttribute('fill') }
    })
    expect(filter).toContain('drop-shadow')
    expect(fill).toBe('currentColor')
    // Dark theme `--color-followup` (#f5c842).
    expect(color).toBe('rgb(245, 200, 66)')
  })

  test('row menu: Follow-up › "Pick a date or interval…" opens the popover; "Followed up" stamps the task', async ({ page }) => {
    const row = taskRowByTitle(page, 'beta')
    const title = row.locator('span[data-task-title="beta"]')
    const tb = (await title.boundingBox())!
    await page.mouse.click(tb.x + 5, tb.y + 5, { button: 'right' })
    await page.getByRole('menuitem', { name: /^Follow-up/ }).click()
    await page.getByRole('menuitem', { name: 'Pick a date or interval…' }).click()
    const pop = popover(page)
    await expect(pop).toBeVisible()
    await expectInViewport(page, pop)
    await expect(pop.getByRole('textbox', { name: 'Next follow-up' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()

    await page.mouse.click(tb.x + 5, tb.y + 5, { button: 'right' })
    await page.getByRole('menuitem', { name: 'Followed up' }).click()
    await expect.poll(() => followupOf(page, 'beta')).toEqual({ next: '2026-11-10 00:00', last: '2026-10-10 15:30' })
  })

  test('task editor: Next commits on Tab; Last accepts past dates only', async ({ page }) => {
    await taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]').dblclick()
    const next = page.getByRole('textbox', { name: 'Next follow-up' })
    await expect(next).toHaveValue('')
    await next.click()
    await next.fill('3d')
    await expect(page.getByText('Tue 13 Oct')).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(next).not.toBeFocused()
    await expect(next).toHaveValue('Tue 13 Oct')
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-13 00:00', last: null })

    const last = page.getByRole('textbox', { name: 'Last follow-up' })
    await last.click()
    await last.fill('tomorrow')
    await expect(page.getByText("Last follow-up can't be in the future")).toBeVisible()
    await last.fill('1 Oct')
    await page.keyboard.press('Enter')
    await expect(last).toHaveValue('Thu 1 Oct')
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-13 00:00', last: '2026-10-01 00:00' })
  })

  test('Quick Add: a new task gets the default follow-up (today + 1 month)', async ({ page }) => {
    await page.keyboard.press('Control+Space')
    const dialog = page.getByRole('dialog', { name: 'Quick add task' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('gamma')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(taskRowByTitle(page, 'gamma').getByRole('button', { name: 'Follow-up: Tue 10 Nov', exact: true })).toBeVisible()
    await expect.poll(() => followupOf(page, 'gamma')).toEqual({ next: '2026-11-10 00:00', last: null })
  })
})
