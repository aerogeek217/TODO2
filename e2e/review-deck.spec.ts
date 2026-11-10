import { expect, test, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D26 · the review deck in the real browser: opened from a list tab's menu
 * on the tab's tasks; ⏎ in the Status update line marks the task followed
 * up with that update and opens the next card with its line focused; Skip
 * and a jump through the queue rail. The person menu's Review with X… (a
 * row's avatar) and the person task dialog's Review button (the dialog
 * closed first) open it on the person's open tasks.
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
  await expect(rail(page).locator('[data-review-row]')).toHaveText([
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

const PEOPLE_SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz'],
  tasks: [
    { title: 'Answer Northwind on the SLA', people: ['Aisha Rahman'] },
    { title: 'Ben’s own task', people: ['Ben Ortiz'] },
    { title: 'Shared rollout plan', people: ['Ben Ortiz', 'Aisha Rahman'] },
    { title: 'Closed already', people: ['Aisha Rahman'], isCompleted: true },
  ],
  listDefinitions: [{ name: 'Everything', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0 }] })] }],
  }],
}

const personDeck = (page: Page) => page.locator('[data-review-deck]')

test('a row’s avatar › Review with X…: the deck on the person’s open tasks', async ({ page }) => {
  await seedWorkspace(page, PEOPLE_SEED)
  await wsListWidget(page, TAB).waitFor({ state: 'visible' })
  const row = wsListWidget(page, TAB).locator('[data-todo-id]').filter({ hasText: 'Shared rollout plan' })
  await row.locator('[data-person-avatar="Aisha Rahman"]').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: '@Aisha Rahman' })
  await expect(menu.getByRole('menuitem').first()).toHaveText('Review with Aisha Rahman…')
  await menu.getByRole('menuitem', { name: 'Review with Aisha Rahman…' }).click()

  await expect(personDeck(page)).toBeVisible()
  await expect(personDeck(page).getByTestId('review-position')).toHaveText('1 of 2')
  await expect(personDeck(page).getByRole('navigation', { name: 'Review queue' }).locator('[data-review-row]'))
    .toHaveText([/Answer Northwind/, /Shared rollout plan/])
  await expect(personDeck(page).getByLabel('Status update · today')).toBeFocused()
})

test('the person task dialog’s Review button: the dialog closes, then the deck opens on her open tasks; Esc closes it', async ({ page }) => {
  await seedWorkspace(page, PEOPLE_SEED)
  await wsListWidget(page, TAB).waitFor({ state: 'visible' })
  const row = wsListWidget(page, TAB).locator('[data-todo-id]').filter({ hasText: 'Answer Northwind' })
  await row.locator('[data-person-avatar="Aisha Rahman"]').click({ button: 'right' })
  await page.getByRole('menu', { name: '@Aisha Rahman' }).getByRole('menuitem', { name: 'Show tasks' }).click()
  const taskDialog = page.locator('[data-task-dialog]')
  await expect(taskDialog.getByRole('heading')).toHaveText('Aisha Rahman')
  await taskDialog.getByRole('button', { name: 'Review with Aisha Rahman…' }).click()

  await expect(taskDialog).toHaveCount(0)
  await expect(personDeck(page).getByTestId('review-position')).toHaveText('1 of 2')
  await expect(personDeck(page).getByLabel('Status update · today')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(personDeck(page)).toHaveCount(0)
})

test('closing with an update typed asks first: Keep reviewing keeps the text, Discard closes', async ({ page }) => {
  await openDeck(page)
  await updateLine(page).fill('Legal has it, back Thursday')
  await page.keyboard.press('Escape')
  const prompt = page.getByRole('dialog', { name: 'Discard the unrecorded update?' })
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText('“Answer Northwind on the SLA” hasn’t been recorded')
  await expect(prompt.getByRole('button', { name: /Keep reviewing/ })).toBeFocused()

  await prompt.getByRole('button', { name: /Keep reviewing/ }).click()
  await expect(prompt).toHaveCount(0)
  await expect(deck(page)).toBeVisible()
  await expect(updateLine(page)).toHaveValue('Legal has it, back Thursday')
  await expect(updateLine(page)).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(prompt).toBeVisible()
  await prompt.getByRole('button', { name: 'Discard' }).click()
  await expect(deck(page)).toHaveCount(0)
  const task = await storedTask(page, 'Answer Northwind on the SLA')
  expect(task?.lastFollowupAt).toBeUndefined()
  const updates = await readStore<{ todoId: number }>(page, 'statusUpdates')
  expect(updates.filter((u) => u.todoId === task?.id)).toEqual([])
})

// ── Items 7, 10, 11: the rail's sort, the header's lens switch, ✓ when followed up today ──

const LENS_SEED: WorkspaceSeed = {
  ...SEED,
  tags: ['legal'],
  tasks: [
    { title: 'Answer Northwind on the SLA', people: ['Aisha'], dueInDays: 5, tags: ['legal'] },
    { title: 'Map integration points', people: ['Aisha'], dueInDays: 1, lastFollowupInDays: 0 },
    { title: 'Retention addendum', people: ['Aisha'], dueInDays: 3, tags: ['legal'] },
    { title: 'Renew the licences', people: ['Aisha'] },
  ],
  lenses: [{ id: 'lens-legal', name: 'Legal', predicate: { tags: [1] } }],
}

async function pickLens(page: Page, name: string) {
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  await expect(control).toHaveAccessibleName(`Lens: ${name}`)
}

async function reviewTab(page: Page, n: number) {
  await wsTab(page, TAB).click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: new RegExp(`Review these ${n} tasks`) }).click()
  await expect(deck(page)).toBeVisible()
}

test('the rail’s sort reorders the rail, keeps the card and steps in the order shown; ✓ marks a task followed up today', async ({ page }) => {
  await seedWorkspace(page, LENS_SEED)
  await wsListWidget(page, TAB).waitFor({ state: 'visible' })
  await reviewTab(page, 4)
  // Followed up today outside the review: ✓ from the start, counted.
  await expect(railRow(page, 'Map integration')).toHaveAttribute('data-mark', 'done')
  await expect(deck(page).getByTestId('review-followed-up')).toHaveText('1 followed up')

  await deck(page).getByTestId('review-sort').click()
  await page.getByRole('menu', { name: 'Sort the queue' }).getByRole('menuitemradio', { name: /^Due/ }).click()
  await expect(deck(page).getByTestId('review-sort')).toHaveText(/Sort:\s*Due/)
  await expect(rail(page).locator('[data-review-row]')).toHaveText([
    /Map integration/, /Retention addendum/, /Answer Northwind/, /Renew the licences/,
  ])
  await expect(cardTitle(page)).toHaveText('Answer Northwind on the SLA')
  await expect(deck(page).getByTestId('review-position')).toHaveText('3 of 4')
  await deck(page).getByRole('button', { name: /^Skip/ }).click()
  await expect(cardTitle(page)).toHaveText('Renew the licences')
  await page.keyboard.press('Alt+ArrowLeft')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(cardTitle(page)).toHaveText('Retention addendum')
})

test('the header’s lens switch: −N under the lens; a click takes the list again without it, keeping the card', async ({ page }) => {
  await seedWorkspace(page, LENS_SEED)
  await wsListWidget(page, TAB).waitFor({ state: 'visible' })
  await pickLens(page, 'Legal')
  await reviewTab(page, 2)
  const sw = deck(page).getByTestId('lens-switch')
  await expect(sw).toHaveAttribute('aria-pressed', 'true')
  await expect(sw).toHaveText('−2')
  await deck(page).getByRole('button', { name: /^Skip/ }).click()
  await expect(cardTitle(page)).toHaveText('Retention addendum')
  await sw.click()
  await expect(sw).toHaveAttribute('aria-pressed', 'false')
  await expect(deck(page).getByTestId('review-position')).toHaveText('3 of 4')
  await expect(cardTitle(page)).toHaveText('Retention addendum')
  await expect(railRow(page, 'Answer Northwind')).toHaveAttribute('data-mark', 'skipped')
  await sw.click()
  await expect(deck(page).getByTestId('review-position')).toHaveText('2 of 2')
})
