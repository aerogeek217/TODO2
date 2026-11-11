import { expect, test, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, wsListWidget, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { openFilterPicker } from './fixtures/filters'

/**
 * The filtered-tasks panel (the top bar's `N of M` counter) offers Review
 * these N tasks beside Copy tasks: the review deck on exactly the tasks the
 * panel lists, in its order — the panel closes first. Desktop only, one deck
 * at a time, none with no task.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Ann plan', people: ['Ann'] },
    { title: 'Ann call', people: ['Ann'] },
    { title: 'Bob task', people: ['Bob'] },
    { title: 'Ann report', people: ['Ann'] },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const panel = (page: Page) => page.locator('[data-filter-panel]')
const reviewButton = (page: Page) => panel(page).getByRole('button', { name: /^Review these \d+ tasks$/ })
const deck = (page: Page) => page.getByRole('dialog', { name: 'Filtered tasks' })

async function openPanelOnAnn(page: Page) {
  await seedWorkspace(page, SEED)
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toHaveLength(4)
  await openFilterPicker(page, 'People')
  await page.getByRole('option', { name: 'Ann' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('header').getByRole('button', { name: '3 of 4 open tasks shown. Show them' }).click()
  await expect(panel(page)).toBeVisible()
}

test.use({ viewport: { width: 1280, height: 800 } })

test('Review these 3 tasks opens the deck on the panel’s tasks, in its order; the panel closes; a follow-up is recorded', async ({ page }) => {
  await openPanelOnAnn(page)
  const listed = await rowTitles(panel(page))
  expect(listed).toHaveLength(3)
  await expect(reviewButton(page)).toHaveText('Review these 3 tasks')

  await reviewButton(page).click()
  await expect(panel(page)).toHaveCount(0)
  await expect(deck(page)).toBeVisible()
  await expect(deck(page).getByTestId('review-position')).toHaveText('1 of 3')
  const rail = deck(page).getByRole('navigation', { name: 'Review queue' })
  await expect(rail.locator('[data-review-row]')).toHaveText(listed.map((t) => new RegExp(t)))
  await expect(deck(page).getByTestId('review-card-title')).toHaveText(listed[0]!)

  await deck(page).getByRole('button', { name: /^Mark followed up/ }).click()
  await expect(deck(page).getByTestId('review-followed-up')).toHaveText('1 followed up')
  await expect.poll(async () => {
    const task = (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos')).find((t) => t.title === listed[0])
    return task?.lastFollowupAt != null && new Date(task.lastFollowupAt).toDateString() === new Date().toDateString()
  }).toBe(true)

  await deck(page).getByRole('button', { name: 'Close review' }).click()
  await expect(deck(page)).toHaveCount(0)
})

test('none while a deck is open', async ({ page }) => {
  await openPanelOnAnn(page)
  await expect(reviewButton(page)).toBeVisible()
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/review-store.ts' as string)) as {
      useReviewStore: { getState: () => { start: (s: { source: { kind: string; title: string; description: string }; ids: number[] }) => void } }
    }
    mod.useReviewStore.getState().start({ source: { kind: 'list', title: 'Elsewhere', description: '' }, ids: [1] })
  })
  await expect(reviewButton(page)).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Elsewhere' })).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the screen filter’s task dialog has no Review action', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('dialog', { name: 'Filters' }).getByPlaceholder('Filter…').fill('ann')
    await page.getByRole('button', { name: 'Show 3 tasks' }).click()
    const dialog = page.locator('[data-task-dialog]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Copy tasks/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Review/ })).toHaveCount(0)
  })
})
