import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { addFollowupInterval, DEFAULT_FOLLOWUP_INTERVAL } from '../src/utils/followup'

/**
 * A task's status updates in a real browser: added in the editor (Esc on an
 * entry being edited stays in the editor — a focus handoff JSDOM can't
 * vouch for) and shown in the row's notes preview; added with a Mark
 * followed up from the follow-up popover, where one Undo takes back both.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    { title: 'Renew the vendor contract', followupInDays: 2, statusUpdates: [{ text: 'asked for the old contract', inDays: -6 }] },
    { title: 'Bare task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c', rows: [wsRow({ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })
const notesCell = (row: Locator) => row.locator('[data-row-cell="notes"]')

/** `MM/DD` of the day `n` days from today. */
function mmdd(n = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** The stored status updates of `title` (text, followedUp), in the order written. */
async function storedUpdates(page: Page, title: string): Promise<Array<[string, boolean]>> {
  const task = (await readStore<{ id: number; title: string }>(page, 'todos')).find((t) => t.title === title)
  return (await readStore<{ id: number; todoId: number; text: string; followedUp?: boolean }>(page, 'statusUpdates'))
    .filter((u) => u.todoId === task?.id)
    .sort((a, b) => a.id - b.id)
    .map((u) => [u.text, u.followedUp === true])
}

test('entering a status counts as following up on its day, when newer: Last moves, the next follow-up by the rule, one Undo takes back all', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    tasks: [{ title: 'Late one', followupInDays: -5 }],
  })
  const task = async () => (await readStore<{ title: string; lastFollowupAt?: Date; nextFollowupAt?: Date }>(page, 'todos'))
    .find((t) => t.title === 'Late one')
  const before = (await task())?.nextFollowupAt
  await taskRowByTitle(page, 'Late one').locator('span[data-task-title="Late one"]').dblclick()
  const last = editor(page).getByRole('textbox', { name: 'Last follow-up' })
  await expect(last).toHaveValue('')

  const popover = page.getByRole('dialog', { name: 'Add a status update' })
  await editor(page).getByRole('button', { name: '+ Add update' }).click()
  await popover.getByRole('textbox', { name: 'New status update', exact: true }).fill('called them')
  await popover.getByRole('textbox', { name: 'New status update’s day' }).fill('yesterday')
  await popover.getByRole('textbox', { name: 'New status update', exact: true }).press('Enter')

  // Dated yesterday: Last is yesterday, and the late next follow-up — before that day — moved on.
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(0, 0, 0, 0)
  await expect.poll(async () => (await task())?.lastFollowupAt?.getTime()).toBe(yesterday.getTime())
  await expect(last).not.toHaveValue('')
  // The rule (Settings' default interval, on in a fresh database) counted from that day.
  expect(before?.getTime()).toBeLessThan(yesterday.getTime())
  expect((await task())?.nextFollowupAt?.getTime()).toBe(addFollowupInterval(yesterday, DEFAULT_FOLLOWUP_INTERVAL).getTime())
  await expect(page.getByText(`Followed up ${mmdd(-1)} · status update added`)).toBeVisible()
  expect(await storedUpdates(page, 'Late one')).toEqual([['called them', true]])

  // An older day than that: only the entry.
  await editor(page).getByRole('button', { name: '+ Add update' }).click()
  await popover.getByRole('textbox', { name: 'New status update', exact: true }).fill('emailed before that')
  await popover.getByRole('textbox', { name: 'New status update’s day' }).fill(mmdd(-3))
  await popover.getByRole('textbox', { name: 'New status update', exact: true }).press('Enter')
  await expect.poll(() => storedUpdates(page, 'Late one')).toEqual([['called them', true], ['emailed before that', false]])
  expect((await task())?.lastFollowupAt?.getTime()).toBe(yesterday.getTime())

  // Undo takes the older entry, then the first entry with its follow-up.
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect.poll(() => storedUpdates(page, 'Late one')).toEqual([['called them', true]])
  await page.keyboard.press('Control+z')
  await expect.poll(() => storedUpdates(page, 'Late one')).toEqual([])
  expect((await task())?.lastFollowupAt).toBeUndefined()
  expect((await task())?.nextFollowupAt?.getTime()).toBe(before?.getTime())
})

test('an update added in the editor shows in the row’s notes preview; Esc while editing one stays in the editor', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Bare task').locator('span[data-task-title="Bare task"]').dblclick()
  await expect(editor(page)).toBeVisible()

  // The Add update popover: opened from its button, above the editor; ⏎ adds and closes it.
  const addButton = editor(page).getByRole('button', { name: '+ Add update' })
  const popover = page.getByRole('dialog', { name: 'Add a status update' })
  const add = popover.getByRole('textbox', { name: 'New status update', exact: true })
  await addButton.click()
  await expect(add).toBeFocused()
  await add.fill('sent the draft')
  await popover.getByRole('textbox', { name: 'New status update’s day' }).fill('yesterday')
  await add.press('Enter')
  await expect(popover).toHaveCount(0)
  await expect(addButton).toBeFocused()
  await addButton.press('Enter')
  await add.fill('waiting on legal')
  await add.press('Enter')
  await expect(addButton).toBeFocused()
  // Esc closes the popover only, and adds what was typed.
  await addButton.click()
  await add.fill('this too')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
  await expect(addButton).toBeFocused()
  const list = editor(page).getByRole('list', { name: 'Status updates' })
  await expect(list.locator('[data-status-update]')).toHaveText([`${mmdd()}this too`, `${mmdd()}waiting on legal`, `${mmdd(-1)}sent the draft`])

  // Edit in place: Esc cancels the edit, not the editor; focus back on the entry's edit button.
  const edit = list.getByRole('button', { name: `Edit status update: ${mmdd(-1)} sent the draft` })
  await edit.click()
  const text = editor(page).getByRole('textbox', { name: 'Status update', exact: true })
  await expect(text).toBeFocused()
  await text.fill('scrapped')
  await page.keyboard.press('Escape')
  await expect(text).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
  await expect(edit).toBeFocused()
  // Its edit / delete show while the keyboard is on the entry.
  await expect(list.getByRole('button', { name: `Delete status update: ${mmdd(-1)} sent the draft` })).toHaveCSS('opacity', '1')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toHaveCount(0)
  // Each newer than the last follow-up then: each counted as following up.
  expect(await storedUpdates(page, 'Bare task')).toEqual([['sent the draft', true], ['waiting on legal', true], ['this too', false]])

  // The row's notes cell previews the newest.
  const cell = notesCell(taskRowByTitle(page, 'Bare task'))
  await expect(cell).toHaveAccessibleName('Edit status and notes')
  await cell.hover()
  await expect(page.getByRole('tooltip')).toHaveText(`${mmdd()} this too`)
})

test('the follow-up popover’s update line: Enter marks followed up and adds the update; one Undo takes back both', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = taskRowByTitle(page, 'Renew the vendor contract')
  await row.getByRole('button', { name: /^Follow-up: / }).click()
  const popover = page.getByRole('dialog', { name: 'Follow-up' })
  await expect(popover).toBeVisible()
  await expect(popover.locator('[data-newest-update]')).toHaveText(`${mmdd(-6)} asked for the old contract`)

  const line = popover.getByRole('textbox', { name: 'Status update' })
  await line.fill('legal signed off')
  await expect(popover.getByRole('button', { name: 'Mark followed up + add update' })).toBeVisible()
  await line.press('Enter')
  // It stays open for a date, the line emptied, the entry as the newest.
  await expect(line).toHaveValue('')
  await expect(popover.locator('[data-newest-update]')).toHaveText(`${mmdd()} legal signed off`)

  await expect.poll(() => storedUpdates(page, 'Renew the vendor contract'))
    .toEqual([['asked for the old contract', false], ['legal signed off', true]])
  const lastFollowup = async () => (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos'))
    .find((t) => t.title === 'Renew the vendor contract')?.lastFollowupAt
  await expect.poll(lastFollowup).toBeDefined()

  await expect(page.getByText('Followed up · status update added')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => storedUpdates(page, 'Renew the vendor contract')).toEqual([['asked for the old contract', false]])
  await expect.poll(lastFollowup).toBeUndefined()
})
