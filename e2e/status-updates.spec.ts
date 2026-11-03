import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

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
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] }] }] }],
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

test('an update added in the editor shows in the row’s notes preview; Esc while editing one stays in the editor', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Bare task').locator('span[data-task-title="Bare task"]').dblclick()
  await expect(editor(page)).toBeVisible()

  const add = editor(page).getByRole('textbox', { name: 'New status update', exact: true })
  await add.fill('sent the draft')
  await editor(page).getByRole('textbox', { name: 'New status update’s day' }).fill('yesterday')
  await add.press('Enter')
  await add.fill('waiting on legal')
  await add.press('Enter')
  await expect(add).toBeFocused()
  const list = editor(page).getByRole('list', { name: 'Status updates' })
  await expect(list.locator('[data-status-update]')).toHaveText([`${mmdd()}waiting on legal`, `${mmdd(-1)}sent the draft`])

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
  expect(await storedUpdates(page, 'Bare task')).toEqual([['sent the draft', false], ['waiting on legal', false]])

  // The row's notes cell previews the newest.
  const cell = notesCell(taskRowByTitle(page, 'Bare task'))
  await expect(cell).toHaveAccessibleName('Edit status and notes')
  await cell.hover()
  await expect(page.getByRole('tooltip')).toHaveText(`${mmdd()} waiting on legal`)
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
  await expect(popover).toHaveCount(0)

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
