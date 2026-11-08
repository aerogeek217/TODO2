import { expect, test, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D26 · the review deck in the real browser: opened from a list tab's menu
 * on the tab's tasks; ⏎ in the Status update line marks the task followed
 * up with that update and opens the next card with its line focused; Skip
 * and a jump through the queue rail; the editor opened over the deck, Esc
 * closing it and then the deck.
 */

const TAB = 'r1'

const SEED: WorkspaceSeed = {
  people: ['Aisha'],
  tasks: [
    { title: 'Answer Northwind on the SLA', people: ['Aisha'], dueInDays: -2, followupInDays: -3 },
    { title: 'Map integration points', people: ['Aisha'], followupInDays: 0 },
    { title: 'Retention addendum', people: ['Aisha'], dueInDays: 3 },
    { title: 'Renew the licences', people: ['Aisha'] },
  ],
  listDefinitions: [{ name: 'Aisha 1:1', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0 }] })] }],
  }],
}

test.use({ viewport: { width: 1280, height: 800 } })

const deck = (page: Page) => page.getByRole('dialog', { name: 'Aisha 1:1' })
const updateLine = (page: Page) => deck(page).getByLabel('Status update · today')
const cardTitle = (page: Page) => deck(page).getByTestId('review-card-title')
const rail = (page: Page) => deck(page).getByRole('navigation', { name: 'Review queue' })
const railRow = (page: Page, title: string) => rail(page).getByRole('button', { name: new RegExp(`^${title}`) })

async function openDeck(page: Page): Promise<void> {
  await seedWorkspace(page, SEED)
  await wsListWidget(page, TAB).waitFor({ state: 'visible' })
  await wsTab(page, TAB).click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: /Review these 4 tasks/ }).click()
  await expect(deck(page)).toBeVisible()
}

async function storedTask(page: Page, title: string) {
  return (await readStore<{ id: number; title: string; lastFollowupAt?: Date; nextFollowupAt?: Date }>(page, 'todos')).find((t) => t.title === title)
}

const isToday = (d: Date | undefined) => !!d && new Date(d).toDateString() === new Date().toDateString()

test('a list tab’s menu opens the deck on its tasks, in the list’s order, on the first card', async ({ page }) => {
  await openDeck(page)
  await expect(deck(page).getByTestId('review-position')).toHaveText('1 of 4')
  await expect(cardTitle(page)).toHaveText('Answer Northwind on the SLA')
  await expect(updateLine(page)).toBeFocused()
  await expect(rail(page).getByRole('button')).toHaveText([
    /Answer Northwind/, /Map integration/, /Retention addendum/, /Renew the licences/,
  ])
  await expect(railRow(page, 'Answer Northwind')).toHaveAttribute('aria-current', 'true')
})

test('an update and ⏎: followed up today with the update; the next card opens with its line focused', async ({ page }) => {
  await openDeck(page)
  await updateLine(page).fill('Infra says 99.9% needs a second region')
  await page.keyboard.press('Enter')

  await expect(cardTitle(page)).toHaveText('Map integration points')
  await expect(updateLine(page)).toBeFocused()
  await expect(updateLine(page)).toHaveValue('')
  await expect(deck(page).getByTestId('review-followed-up')).toHaveText('1 followed up')
  await expect(railRow(page, 'Answer Northwind')).toHaveAttribute('data-mark', 'done')

  await expect.poll(async () => isToday((await storedTask(page, 'Answer Northwind on the SLA'))?.lastFollowupAt)).toBe(true)
  const task = await storedTask(page, 'Answer Northwind on the SLA')
  const updates = await readStore<{ todoId: number; text: string; followedUp?: boolean }>(page, 'statusUpdates')
  expect(updates.filter((u) => u.todoId === task?.id).map((u) => [u.text, u.followedUp])).toEqual([['Infra says 99.9% needs a second region', true]])
})

test('Skip marks the task skipped and writes nothing; a rail row jumps to its card', async ({ page }) => {
  await openDeck(page)
  const before = await storedTask(page, 'Answer Northwind on the SLA')
  await deck(page).getByRole('button', { name: /^Skip/ }).click()
  await expect(cardTitle(page)).toHaveText('Map integration points')
  await expect(railRow(page, 'Answer Northwind')).toHaveAttribute('data-mark', 'skipped')
  expect(await storedTask(page, 'Answer Northwind on the SLA')).toEqual(before)

  await railRow(page, 'Renew the licences').click()
  await expect(cardTitle(page)).toHaveText('Renew the licences')
  await expect(deck(page).getByTestId('review-position')).toHaveText('4 of 4')
  await expect(railRow(page, 'Renew the licences')).toHaveAttribute('aria-current', 'true')
  // A click on the rail leaves the focus for the card's update line.
  await expect(updateLine(page)).toBeFocused()

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(cardTitle(page)).toHaveText('Retention addendum')
})

test('the editor opens over the deck; Esc closes it, then the deck', async ({ page }) => {
  await openDeck(page)
  await deck(page).getByRole('button', { name: 'Open in editor' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect(deck(page)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(deck(page)).toBeVisible()
  await expect(updateLine(page)).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(deck(page)).toHaveCount(0)
})
