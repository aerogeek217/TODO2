import { expect, test, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'

/**
 * Slash commands in Quick Add: the `/` menu (open, filter, keys, argument
 * states, Escape), a full command typed without the menu, and the Details ⇥
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
  return await page.evaluate(async (target) => {
    return await new Promise<StoredTodo | null>((resolve, reject) => {
      const req = indexedDB.open('todo2')
      req.onsuccess = () => {
        const idb = req.result
        const all = idb.transaction(['todos'], 'readonly').objectStore('todos').getAll()
        all.onsuccess = () => {
          const rows = all.result as Array<Record<string, unknown>>
          const t = rows.find((r) => r.title === target)
          idb.close()
          if (!t) { resolve(null); return }
          const day = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : undefined)
          resolve({
            title: t.title as string,
            urgent: t.urgent as boolean | undefined,
            important: t.important as boolean | undefined,
            focus: t.focus as boolean | undefined,
            statusId: t.statusId as number | undefined,
            dueDate: day(t.dueDate),
            nextFollowupAt: t.nextFollowupAt ? day(t.nextFollowupAt) : null,
            recurrence: (t.recurrenceRule as { type?: string } | undefined)?.type,
          })
        }
        all.onerror = () => { idb.close(); reject(all.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, title)
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

    // Typing filters by prefix; ↓ moves; ⏎ picks (and never submits).
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
    await page.keyboard.press('Enter')
    await expect(arg).toBeHidden()
    await expect(input).toHaveValue('Call legal about SOW /followup 2w ')

    // An unreadable date shows the error; ⏎ does nothing; Esc closes only the popup.
    await page.keyboard.type('/due frday')
    const due = page.getByRole('listbox', { name: 'Due date' })
    await expect(due.getByRole('alert')).toHaveText(/Can't read "frday"/)
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(due).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(input).toHaveValue('Call legal about SOW /followup 2w /due frday')
    await expect(dialog.getByText("Can't read date:")).toBeVisible()

    // A second Esc closes the bar.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
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
