import { expect, test, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'
import { afterTransactionsOn, readStore } from './fixtures/db'

/**
 * Slash commands in Quick Add: the `/` menu (open, filter, keys, argument
 * states, Escape), ⏎ adding the task while the menu is open, a full command
 * typed without the menu, and the Details ⇥
 * handoff carrying the parsed commands into the task editor. Real-browser
 * because the popup is portalled, anchored at the trigger character from the
 * measured input, and keys hop between the input, the popup and the dialog.
 */

interface StoredTodo {
  title: string
  urgent?: boolean
  important?: boolean
  focus?: boolean
  statusId?: number
  dueDate?: string
  nextFollowupAt?: string | null
  recurrence?: string
}

async function readTodo(page: Page, title: string): Promise<StoredTodo | null> {
  const t = (await readStore(page, 'todos')).find((r) => r.title === title)
  if (!t) return null
  const day = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : undefined)
  return {
    title: t.title as string,
    urgent: t.urgent as boolean | undefined,
    important: t.important as boolean | undefined,
    focus: t.focus as boolean | undefined,
    statusId: t.statusId as number | undefined,
    dueDate: day(t.dueDate),
    nextFollowupAt: t.nextFollowupAt ? day(t.nextFollowupAt) : null,
    recurrence: (t.recurrenceRule as { type?: string } | undefined)?.type,
  }
}

/** `YYYY-M-D` of today + `days`, in the page's clock. */
async function dayFromToday(page: Page, days: number): Promise<string> {
  return await page.evaluate((n) => {
    const t = new Date()
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }, days)
}

async function openQuickAdd(page: Page) {
  await page.keyboard.press('Control+Space')
  const dialog = page.getByRole('dialog', { name: 'Quick add task' })
  const input = dialog.getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return { dialog, input }
}

test.describe('Quick Add slash commands', () => {
  test.beforeEach(async ({ page }) => {
    await seedTaskList(page, { statuses: ['Waiting', 'In review'] })
  })

  test('the / menu: open, filter, keys, argument state, Escape', async ({ page }) => {
    const { dialog, input } = await openQuickAdd(page)
    await page.keyboard.type('Call legal about SOW /')

    const menu = page.getByRole('listbox', { name: 'Commands' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option')).toHaveCount(7)
    await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
    await expect(menu).toContainText('or type the whole command')

    // Anchored at the trigger: below the input, starting near the `/`.
    const inputBox = (await input.boundingBox())!
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height)
    expect(menuBox.x).toBeGreaterThan(inputBox.x + 100)

    // Typing filters by prefix; ↓ moves; ⏎ after ↓ picks (no submit).
    await page.keyboard.type('fo')
    await expect(menu.getByRole('option')).toHaveCount(2)
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('option', { name: /followup/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(input).toHaveValue('Call legal about SOW /followup ')

    // The same popup goes on to the argument.
    const arg = page.getByRole('listbox', { name: 'Next follow-up' })
    await expect(arg).toBeVisible()
    await expect(arg.getByRole('option', { name: /1m/ })).toContainText('default')
    await page.keyboard.type('2w')
    await expect(arg.getByRole('option')).toHaveCount(1)
    // Tab picks.
    await page.keyboard.press('Tab')
    await expect(arg).toBeHidden()
    await expect(input).toHaveValue('Call legal about SOW /followup 2w ')

    // An unreadable date shows the error; Esc closes only the popup.
    await page.keyboard.type('/due frday')
    const due = page.getByRole('listbox', { name: 'Due date' })
    await expect(due.getByRole('alert')).toHaveText(/Can't read "frday"/)
    await page.keyboard.press('Escape')
    await expect(due).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(input).toHaveValue('Call legal about SOW /followup 2w /due frday')
    await expect(dialog.getByText("Can't read date:")).toBeVisible()

    // A second Esc closes the bar.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('⏎ adds the task while the menu is open: a half-typed token resolves, a partial date stays in the title', async ({ page }) => {
    const { dialog, input } = await openQuickAdd(page)
    // Half-typed command: completed to its best match.
    await page.keyboard.type('Draft memo /ur')
    await expect(page.getByRole('listbox', { name: 'Commands' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => readTodo(page, 'Draft memo')).toMatchObject({ urgent: true })

    // A date still being typed (only a hint shows): added, the date left in the title.
    await openQuickAdd(page)
    await page.keyboard.type('Pay invoice /due 24')
    await expect(page.getByRole('listbox', { name: 'Due date' })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => readTodo(page, 'Pay invoice /due 24')).not.toBeNull()
    expect((await readTodo(page, 'Pay invoice /due 24'))?.dueDate).toBeUndefined()

    // Only tokens: nothing is added, and the bar says why.
    await openQuickAdd(page)
    await page.keyboard.type('/urgent ')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('No title:')).toBeVisible()
    await expect(input).toHaveValue('/urgent ')
  })

  test('/status completes status names; a multi-word name is quoted', async ({ page }) => {
    const { input } = await openQuickAdd(page)
    await page.keyboard.type('Vendor contract /status in')
    const status = page.getByRole('listbox', { name: 'Status' })
    await expect(status.getByRole('option')).toHaveText(['In review'])
    await page.keyboard.press('Tab')
    await expect(input).toHaveValue('Vendor contract /status "In review" ')
    await expect(status).toBeHidden()
  })

  test('a whole command typed without the menu sets the task fields', async ({ page }) => {
    const { dialog, input } = await openQuickAdd(page)
    // A trailing space after each argument closes the popup, so ⏎ adds.
    await input.pressSequentially('Renew domain /due tomorrow /urgent /repeat weekly /followup none /status waiting a/b ')
    await expect(page.getByRole('listbox')).toBeHidden()
    const chips = dialog.getByRole('group', { name: 'What the task gets' })
    await expect(chips).toContainText('Urgent')
    await expect(chips).toContainText('No follow-up')
    await expect(chips).toContainText('Every ')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()

    await expect.poll(() => readTodo(page, 'Renew domain a/b')).not.toBeNull()
    const todo = await readTodo(page, 'Renew domain a/b')
    expect(todo).toMatchObject({
      urgent: true,
      dueDate: await dayFromToday(page, 1),
      recurrence: 'weekly',
      nextFollowupAt: null,
    })
    expect(todo?.statusId).toBeDefined()
  })

  test('plain date words stay in the title', async ({ page }) => {
    const { dialog, input } = await openQuickAdd(page)
    await input.pressSequentially('Call mom tomorrow by fri every week')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect.poll(() => readTodo(page, 'Call mom tomorrow by fri every week')).not.toBeNull()
    const todo = await readTodo(page, 'Call mom tomorrow by fri every week')
    expect(todo?.dueDate).toBeUndefined()
    expect(todo?.recurrence).toBeUndefined()
    // Every new task still gets the default next follow-up.
    expect(todo?.nextFollowupAt).not.toBeNull()
  })

  test('Details ⇥ carries the parsed commands into the editor', async ({ page }) => {
    const { input } = await openQuickAdd(page)
    await input.pressSequentially('Call legal /important /focus /due 2w /followup 1w ')
    await page.keyboard.press('Tab')

    const title = page.getByPlaceholder('New task… (@person #tag /command)')
    await expect(title).toHaveValue('Call legal')
    await expect(page.getByRole('button', { name: /Important/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Focus/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Urgent/ })).toHaveAttribute('aria-pressed', 'false')

    await page.getByRole('button', { name: 'Create task' }).click()
    await expect.poll(() => readTodo(page, 'Call legal')).not.toBeNull()
    const todo = await readTodo(page, 'Call legal')
    expect(todo).toMatchObject({
      important: true,
      focus: true,
      dueDate: await dayFromToday(page, 14),
      nextFollowupAt: await dayFromToday(page, 7),
    })
    expect(todo?.urgent).toBeUndefined()
  })
})

test.describe('Quick Add metadata write', () => {
  test('a task with #tag @person /due is added without errors and shows its chips', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await seedTaskList(page, { tags: ['ops'], people: [{ name: 'Dana Kim', initials: 'DK' }] })
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()

    const { dialog, input } = await openQuickAdd(page)
    await input.pressSequentially('Ship it #ops @Dana /due tomorrow ')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()

    const row = taskRowByTitle(page, 'Ship it')
    await expect(row.getByText('#ops')).toBeVisible()
    await expect(row.getByText('DK')).toBeVisible()
    // The assignment loads the new row triggered (its chips are showing) have
    // finished: no error comes after this.
    await afterTransactionsOn(page, ['todoPeople', 'todoTags'])
    expect(errors).toEqual([])
  })
})
