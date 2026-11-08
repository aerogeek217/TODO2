import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { seedWorkspace, wsCell, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The morning brief's parts as widgets (D25 L) in a real browser: Today's
 * + puts a suggestion in Focus (it moves up into the rows); Clear Focus…
 * keeps the open ones or clears all, each one undo step; What changed says
 * a task went late; a Project pulse card opens its tag's open tasks.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TAGS: WorkspaceSeed['tags'] = [{ name: 'Project: Atlas', color: '#4f8cff' }, { name: 'Project: Beta', color: '#e05050' }]

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Ship the beta', focus: true, dueInDays: 2, tags: ['Project: Atlas'] },
  { title: 'Book the venue', focus: true, tags: ['Project: Beta'] },
  { title: 'Write the notes', focus: true, completedInDays: 0 },
  { title: 'Pay the invoice', dueInDays: 0, tags: ['Project: Atlas'] },
  { title: 'Renew the domain', dueInDays: -1, tags: ['Project: Atlas'] },
  { title: 'Plan the offsite', tags: ['Project: Beta'] },
]

/** One column: What changed beside Today, Project pulse under them. */
function seed(tasks: WorkspaceSeed['tasks'] = TASKS): WorkspaceSeed {
  return {
    tags: TAGS,
    tasks,
    layouts: [{ name: 'Brief', columns: [{ id: 'c1', rows: [
      { cells: [
        { id: 'kc', tabs: [{ id: 'changes', kind: 'changes', tagNames: ['Project: Atlas', 'Project: Beta'] }] },
        { id: 'kt', tabs: [{ id: 'today', kind: 'today' }] },
      ] },
      { cells: [{ id: 'kp', tabs: [{ id: 'pulse', kind: 'pulse', tagNames: ['Project: Atlas', 'Project: Beta'] }] }] },
    ] }] }],
  }
}

const today = (page: Page) => page.locator('[data-glance="today"]')
const focusRows = (page: Page) => today(page).locator('[data-row-key] [data-task-title]')
const dialog = (page: Page) => page.locator('[data-task-dialog]')

/** Opens a headless cell's tab menu and picks `item`. */
async function tabMenuItem(page: Page, cell: Locator, item: string): Promise<void> {
  await cell.hover()
  await cell.getByRole('tab').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: item }).click()
}

/** The stored Focus flags, by title. */
async function storedFocus(page: Page): Promise<Record<string, boolean>> {
  const rows = await readStore<{ title: string; focus?: boolean }>(page, 'todos')
  return Object.fromEntries(rows.map((r) => [r.title, r.focus === true]))
}

test('Today: a suggestion’s + puts it in Focus — it moves up into the rows — and Undo takes it back', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect(focusRows(page)).toHaveText(['Ship the beta', 'Book the venue'])
  const suggested = today(page).getByRole('group', { name: 'Suggested' })
  await expect(suggested.locator('[data-suggestion]')).toHaveCount(1)
  await expect(suggested).toContainText('Pay the invoice')

  await suggested.getByRole('button', { name: 'Add “Pay the invoice” to Focus' }).click()
  // By due date: due today comes first.
  await expect(focusRows(page)).toHaveText(['Pay the invoice', 'Ship the beta', 'Book the venue'])
  await expect(today(page).getByRole('group', { name: 'Suggested' })).toHaveCount(0)
  await expect.poll(async () => (await storedFocus(page))['Pay the invoice']).toBe(true)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(focusRows(page)).toHaveText(['Ship the beta', 'Book the venue'])
  await expect.poll(async () => (await storedFocus(page))['Pay the invoice']).toBe(false)
})

test('Clear Focus…: Keep the open ones clears only the done one; Clear all clears every one; each is one undo step', async ({ page }) => {
  await seedWorkspace(page, seed())
  const cell = wsCell(page, 'kt')
  const prompt = page.getByRole('dialog', { name: 'Clear Focus?' })

  // Keep: the open ones stay, the done one leaves Focus.
  await tabMenuItem(page, cell, 'Clear Focus…')
  await expect(prompt).toContainText('Focus holds 2 open and 1 done tasks.')
  await prompt.getByRole('button', { name: 'Keep the 2 open ones for tomorrow' }).click()
  await expect(prompt).toHaveCount(0)
  await expect.poll(() => storedFocus(page)).toMatchObject({ 'Write the notes': false, 'Ship the beta': true, 'Book the venue': true })
  await expect(focusRows(page)).toHaveText(['Ship the beta', 'Book the venue'])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await storedFocus(page))['Write the notes']).toBe(true)

  // Clear all: every Focus task, open and done.
  await tabMenuItem(page, cell, 'Clear Focus…')
  await prompt.getByRole('button', { name: 'Clear all' }).click()
  await expect(today(page)).toContainText('Nothing picked for today')
  await expect.poll(() => storedFocus(page)).toMatchObject({ 'Write the notes': false, 'Ship the beta': false, 'Book the venue': false })
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(focusRows(page)).toHaveText(['Ship the beta', 'Book the venue'])
  await expect.poll(() => storedFocus(page)).toMatchObject({ 'Write the notes': true, 'Ship the beta': true, 'Book the venue': true })
})

test('What changed: a task due yesterday went late; the sentence opens it', async ({ page }) => {
  await seedWorkspace(page, seed())
  const changes = page.locator('[data-glance="changes"]')
  const late = changes.locator('[data-change="late"]')
  await expect(late).toHaveText('1 task went late since yesterday.')
  await expect(changes.locator('[data-change="tag"]')).toHaveText('#Project: Atlas has the most late tasks (1).')
  await expect(changes.locator('[data-change="dueToday"]')).toHaveText('1 task is due today.')
  await late.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('Went late since yesterday')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(1)
  await expect(dialog(page)).toContainText('Renew the domain')
})

test('What changed with nothing to say is quiet', async ({ page }) => {
  await seedWorkspace(page, seed([{ title: 'Plan the offsite' }]))
  await expect(page.locator('[data-glance="changes"] [data-change="none"]')).toHaveText('Nothing new since yesterday.')
})

test('Project pulse: a card per picked tag; a click opens the tag’s open tasks', async ({ page }) => {
  await seedWorkspace(page, seed())
  const cards = page.locator('[data-glance="pulse"] [data-pulse-card]')
  await expect(cards).toHaveCount(2)
  const atlas = cards.first()
  await expect(atlas).toContainText('Project: Atlas')
  await expect(atlas).toContainText('1 late (33%)')
  // Every task was added today: +3 this week.
  await expect(atlas).toContainText('Growing: +3 net in 4 weeks')
  await atlas.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('#Project: Atlas')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(3)
})
