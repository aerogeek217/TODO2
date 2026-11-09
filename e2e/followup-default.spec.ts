import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * Settings' "Set a next follow-up automatically" (on: today + the interval,
 * off: none) governs new tasks and "Mark followed up" — but Mark followed up
 * keeps a next follow-up after today, the setting on or off; one today, past
 * or none gets the rule. The follow-up popover's Next field shows what Mark
 * followed up will leave (the task's later date, else the rule's, with `Was …`
 * under it), Mark followed up untouched lets the rule decide, edited it uses
 * the field; a quick button sets the date only and closes. The new-task editor's Next field
 * starts on the default. Focus, selection and typing are real-browser
 * behaviour.
 *
 * The clock is pinned to Sat 10 Oct 2026 15:30 (default interval 1 month).
 */

const NOW = new Date(2026, 9, 10, 15, 30)

interface TodoRow { title: string; nextFollowupAt?: Date; lastFollowupAt?: Date }
interface TodoStoreModule { useTodoStore: { getState(): { todos: TodoRow[] } } }
interface SettingsStoreModule { useSettingsStore: { getState(): { setAutoFollowup(on: boolean): Promise<void> } } }

/** The stored follow-up dates for `title`, as local `YYYY-MM-DD HH:mm` strings (or null). */
async function followupOf(page: Page, title: string): Promise<{ next: string | null; last: string | null } | null> {
  return page.evaluate(async ({ url, title }) => {
    const mod = (await import(/* @vite-ignore */ url)) as TodoStoreModule
    const t = mod.useTodoStore.getState().todos.find((x) => x.title === title)
    if (!t) return null
    const fmt = (d?: Date) => {
      if (!d) return null
      const x = new Date(d)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`
    }
    return { next: fmt(t.nextFollowupAt), last: fmt(t.lastFollowupAt) }
  }, { url: '/src/stores/todo-store.ts', title })
}

async function setAutoFollowup(page: Page, on: boolean): Promise<void> {
  await page.evaluate(async ({ url, on }) => {
    const mod = (await import(/* @vite-ignore */ url)) as SettingsStoreModule
    await mod.useSettingsStore.getState().setAutoFollowup(on)
  }, { url: '/src/stores/settings-store.ts', on })
}

const popover = (page: Page) => page.getByRole('dialog', { name: 'Follow-up' })

test.describe('the automatic next follow-up', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    // alpha / beta: after today (Tue 13 / Thu 15) · gamma / delta: overdue (10/08 / 10/09).
    await seedTaskList(page, { tasks: [
      { title: 'alpha', followupInDays: 3 },
      { title: 'beta', followupInDays: 5 },
      { title: 'gamma', followupInDays: -2 },
      { title: 'delta', followupInDays: -1 },
    ] })
  })

  test('a later next follow-up shows in the field and Mark followed up keeps it; an edited date is what it sets', async ({ page }) => {
    const row = taskRowByTitle(page, 'alpha')
    await row.getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    const pop = popover(page)
    const input = pop.getByRole('textbox', { name: 'Next follow-up' })
    const followedUp = pop.getByRole('button', { name: 'Mark followed up' })
    await expect(followedUp).toBeFocused()
    await expect(input).toHaveValue('Tue 13 Oct')
    await expect(pop.getByText(/^Now:/)).toHaveCount(0)
    await expect(pop.getByText(/^Was /)).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-13 00:00', last: '2026-10-10 15:30' })
    await expect(page.getByText('Followed up · next follow-up kept')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()

    // A click selects the field's text: typing replaces it.
    await taskRowByTitle(page, 'beta').getByRole('button', { name: 'Follow-up: Thu 15', exact: true }).click()
    await input.click()
    await page.keyboard.type('2w')
    await expect(input).toHaveValue('2w')
    await expect(pop.getByText('Sat 24 Oct')).toBeVisible()
    await followedUp.click()
    await expect.poll(() => followupOf(page, 'beta')).toEqual({ next: '2026-10-24 00:00', last: '2026-10-10 15:30' })
    await expect(page.getByText('Followed up · next follow-up Sat 24 Oct')).toBeVisible()
    await expect(input).toHaveValue('Sat 24 Oct')
  })

  test('an overdue one: the field on today + the interval, Was … under it; ⏎ on Mark followed up sets it; ⏎ in the field sets the next follow-up only', async ({ page }) => {
    await taskRowByTitle(page, 'gamma').getByRole('button', { name: 'Follow-up: 10/08, late', exact: true }).click()
    const pop = popover(page)
    await expect(pop.getByRole('textbox', { name: 'Next follow-up' })).toHaveValue('Tue 10 Nov')
    await expect(pop.getByText('Was 10/08 · overdue')).toBeVisible()
    await expect(pop.getByRole('button', { name: 'Mark followed up' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => followupOf(page, 'gamma')).toEqual({ next: '2026-11-10 00:00', last: '2026-10-10 15:30' })
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()

    await taskRowByTitle(page, 'delta').getByRole('button', { name: 'Follow-up: 10/09, late', exact: true }).click()
    const input = pop.getByRole('textbox', { name: 'Next follow-up' })
    await input.click()
    await page.keyboard.press('Enter')
    // The field's date, set without a follow-up stamp.
    await expect.poll(() => followupOf(page, 'delta')).toEqual({ next: '2026-11-10 00:00', last: null })
  })

  test('the user’s flow: open the pill → type 2w → Mark followed up sets today + 14 days; a quick button then only sets the date', async ({ page }) => {
    await taskRowByTitle(page, 'beta').getByRole('button', { name: 'Follow-up: Thu 15', exact: true }).click()
    const pop = popover(page)
    await pop.getByRole('textbox', { name: 'Next follow-up' }).fill('2w')
    await pop.getByRole('button', { name: 'Mark followed up' }).click()
    await expect.poll(() => followupOf(page, 'beta')).toEqual({ next: '2026-10-24 00:00', last: '2026-10-10 15:30' })

    // Still open: a quick button sets the next follow-up only (as a picked day does).
    await pop.getByRole('button', { name: 'Follow up in 1 month' }).click()
    await expect(pop).toBeVisible()
    await expect.poll(() => followupOf(page, 'beta')).toEqual({ next: '2026-11-10 00:00', last: '2026-10-10 15:30' })
  })

  test('a click into the field selects it once: a second click places the caret; Tab back in selects again', async ({ page }) => {
    await taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    const input = popover(page).getByRole('textbox', { name: 'Next follow-up' })
    await input.click()
    await expect.poll(() => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 10])
    // A second click inside: a caret at the click, nothing selected.
    const box = (await input.boundingBox())!
    await page.mouse.click(box.x + 6, box.y + box.height / 2)
    await expect.poll(() => input.evaluate((el: HTMLInputElement) => el.selectionStart === el.selectionEnd)).toBe(true)
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    await expect(input).toHaveValue('Tue 13 Octx')
    // Tab away (the field's ×) and back.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(input).toBeFocused()
    await page.keyboard.type('3d')
    await expect(input).toHaveValue('3d')
  })

  test('the menu’s Pick a date or interval… opens on the field with its text selected: typing replaces it', async ({ page }) => {
    const title = taskRowByTitle(page, 'alpha').locator('span[data-task-title="alpha"]')
    await title.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /^Follow-up/ }).click()
    await page.getByRole('menuitem', { name: 'Pick a date or interval…' }).click()
    const input = popover(page).getByRole('textbox', { name: 'Next follow-up' })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Tue 13 Oct')
    await page.keyboard.type('3w')
    await expect(input).toHaveValue('3w')
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeVisible()
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-31 00:00', last: null })
  })

  test('off: a later next follow-up is kept, an overdue one cleared — from the popover and from the task menu', async ({ page }) => {
    await setAutoFollowup(page, false)
    const pop = popover(page)
    // The user's report: a set date in 3 days survives Mark followed up.
    await taskRowByTitle(page, 'alpha').getByRole('button', { name: 'Follow-up: Tue 13', exact: true }).click()
    await expect(pop.getByRole('textbox', { name: 'Next follow-up' })).toHaveValue('Tue 13 Oct')
    await expect(pop.getByRole('button', { name: 'Mark followed up' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => followupOf(page, 'alpha')).toEqual({ next: '2026-10-13 00:00', last: '2026-10-10 15:30' })
    await expect(page.getByText('Followed up · next follow-up kept')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()

    await taskRowByTitle(page, 'gamma').getByRole('button', { name: 'Follow-up: 10/08, late', exact: true }).click()
    await expect(pop.getByRole('textbox', { name: 'Next follow-up' })).toHaveValue('')
    await expect(pop.getByText('Was 10/08 · overdue')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect.poll(() => followupOf(page, 'gamma')).toEqual({ next: null, last: '2026-10-10 15:30' })
    await expect(page.getByText('Followed up · no next follow-up')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pop).toBeHidden()

    await taskRowByTitle(page, 'beta').locator('span[data-task-title="beta"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark followed up' }).click()
    await expect.poll(() => followupOf(page, 'beta')).toEqual({ next: '2026-10-15 00:00', last: '2026-10-10 15:30' })

    await taskRowByTitle(page, 'delta').locator('span[data-task-title="delta"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Mark followed up' }).click()
    await expect.poll(() => followupOf(page, 'delta')).toEqual({ next: null, last: '2026-10-10 15:30' })
    await expect(taskRowByTitle(page, 'delta').getByRole('button', { name: /^Follow-up:/ })).toHaveCount(0)
  })
})

test.describe('the new-task editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    await seedTaskList(page, { tasks: [{ title: 'alpha' }] })
  })

  /** Quick Add → title → Details (⇥): the editor in create mode. */
  async function openEditor(page: Page, title: string) {
    await page.keyboard.press('Control+Space')
    const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
    await expect(quickAdd.getByPlaceholder('New task…')).toBeFocused()
    await page.keyboard.type(title)
    await page.keyboard.press('Tab')
    await expect(quickAdd).toBeHidden()
    const editor = page.getByRole('dialog', { name: 'New task' })
    await expect(editor).toBeVisible()
    return editor
  }

  test('Next starts on the default (today + 1 month); cleared, the task gets none', async ({ page }) => {
    let editor = await openEditor(page, 'gamma')
    const next = editor.getByRole('textbox', { name: 'Next follow-up' })
    await expect(next).toHaveValue('Tue 10 Nov')
    await expect(editor.getByText('Default · 1 month')).toBeVisible()
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(() => followupOf(page, 'gamma')).toEqual({ next: '2026-11-10 00:00', last: null })

    // A click into the untouched default selects it: typing replaces it.
    editor = await openEditor(page, 'epsilon')
    const field = editor.getByRole('textbox', { name: 'Next follow-up' })
    await field.click()
    await page.keyboard.type('2w')
    await expect(field).toHaveValue('2w')
    await page.keyboard.press('Tab')
    await expect(field).toHaveValue('Sat 24 Oct')
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(() => followupOf(page, 'epsilon')).toEqual({ next: '2026-10-24 00:00', last: null })

    editor = await openEditor(page, 'delta')
    await editor.getByRole('button', { name: 'Clear next follow-up' }).click()
    await expect(editor.getByRole('textbox', { name: 'Next follow-up' })).toHaveValue('')
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(() => followupOf(page, 'delta')).toEqual({ next: null, last: null })
  })

  test('off: Next starts blank and the task gets none', async ({ page }) => {
    await setAutoFollowup(page, false)
    const editor = await openEditor(page, 'gamma')
    await expect(editor.getByRole('textbox', { name: 'Next follow-up' })).toHaveValue('')
    await expect(editor.getByText(/^Default ·/)).toHaveCount(0)
    await editor.getByRole('button', { name: 'Create task' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(() => followupOf(page, 'gamma')).toEqual({ next: null, last: null })
  })
})
