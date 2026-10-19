import { expect, test, type Locator, type Page } from '@playwright/test'
import { dragRow, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'
import { box } from './fixtures/geometry'

/**
 * A list grouped by Priority (Hot, Focus, Urgent, Important, No priority — a
 * task in each of its groups): dragging a row between the groups writes the
 * flags, or is refused with why.
 */

function seed(list: Partial<NonNullable<WorkspaceSeed['listDefinitions']>[number]> = {}): WorkspaceSeed {
  return {
    listDefinitions: [{ name: 'Priorities', grouping: 'priority', ...list }],
    tasks: [
      { title: 'Launch', focus: true, urgent: true },
      { title: 'Report', urgent: true },
      { title: 'Ideas', important: true },
      { title: 'Renewal', dueInDays: 1 },
      { title: 'Someday' },
    ],
    layouts: [{
      name: 'Main',
      columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }],
    }],
  }
}

const widget = (page: Page) => wsListWidget(page, 't1')

function group(page: Page, key: string): Locator {
  return widget(page).locator(`[data-list-section="${key}"]`)
}

function row(page: Page, title: string, key: string): Locator {
  return group(page, key).locator('[data-row-key]', { has: page.locator(`span[data-task-title="${title}"]`) })
}

async function titlesIn(page: Page, key: string): Promise<string[]> {
  return group(page, key).locator('[data-task-title]').evaluateAll((els) => els.map((el) => el.getAttribute('data-task-title') ?? ''))
}

/** Viewport y just inside the top of `target` (lands before it). */
async function above(target: Locator): Promise<number> {
  return (await box(target)).y + 4
}

interface StoredTodo { title: string; urgent?: boolean; important?: boolean; focus?: boolean }

async function stored(page: Page, title: string): Promise<StoredTodo | undefined> {
  return (await readStore<StoredTodo>(page, 'todos')).find((t) => t.title === title)
}

test('a Focus + Urgent task shows under Hot, Focus and Urgent; due soon counts as Urgent', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect(widget(page).getByTestId('list-group-name')).toHaveText(['Hot', 'Focus', 'Urgent', 'Important', 'No priority'])
  await expect.poll(() => titlesIn(page, 'priority-hot')).toEqual(['Launch'])
  await expect.poll(() => titlesIn(page, 'priority-focus')).toEqual(['Launch'])
  await expect.poll(() => titlesIn(page, 'priority-urgent')).toEqual(['Launch', 'Report', 'Renewal'])
  await expect.poll(() => titlesIn(page, 'priority-important')).toEqual(['Ideas'])
  await expect.poll(() => titlesIn(page, 'no-priority')).toEqual(['Someday'])
  await expect(widget(page).getByTestId('list-summary')).toHaveText('Priority · Manual')
})

test('dragging Urgent → Important sets Important and clears Urgent, as one undo step', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect.poll(() => titlesIn(page, 'priority-important')).toEqual(['Ideas'])
  await dragRow(page, row(page, 'Report', 'priority-urgent'), await above(row(page, 'Ideas', 'priority-important')), async () => {
    await expect(page.getByTestId('cross-group-preview')).toHaveText('Urgent → Important')
  })
  // Dropped above Ideas: a manual list keeps the landing spot.
  await expect.poll(() => titlesIn(page, 'priority-important')).toEqual(['Report', 'Ideas'])
  await expect.poll(() => titlesIn(page, 'priority-urgent')).toEqual(['Launch', 'Renewal'])
  await expect.poll(async () => {
    const t = await stored(page, 'Report')
    return { urgent: t?.urgent ?? false, important: t?.important ?? false }
  }).toEqual({ urgent: false, important: true })

  // One undo takes both flags back.
  await expect(page.getByText('Marked not urgent, important · Report')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => {
    const t = await stored(page, 'Report')
    return { urgent: t?.urgent ?? false, important: t?.important ?? false }
  }).toEqual({ urgent: true, important: false })
  await expect.poll(() => titlesIn(page, 'priority-urgent')).toEqual(['Launch', 'Report', 'Renewal'])
})

test('dragging a task urgent by its due date out of Urgent is refused, saying why', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect.poll(() => titlesIn(page, 'priority-urgent')).toEqual(['Launch', 'Report', 'Renewal'])
  await dragRow(page, row(page, 'Renewal', 'priority-urgent'), await above(row(page, 'Ideas', 'priority-important')), async () => {
    const tip = page.getByTestId('list-drop-refusal')
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Can’t move to Important')
    await expect(tip).toContainText(/Renewal is due .+, within 3 days, so it counts as urgent\./)
    await expect(tip).toContainText('Change its due date or the due-soon range first.')
    await expect(page.getByTestId('cross-group-preview')).toHaveCount(0)
    await expect(widget(page).locator('[data-drop-line]')).toHaveCount(0)
  })
  await expect(page.getByTestId('list-drop-refusal')).toHaveCount(0)
  await expect.poll(() => titlesIn(page, 'priority-urgent')).toEqual(['Launch', 'Report', 'Renewal'])
  await expect.poll(() => titlesIn(page, 'priority-important')).toEqual(['Ideas'])
  expect((await stored(page, 'Renewal'))?.important).toBeUndefined()
})

test('dragging into Hot is refused', async ({ page }) => {
  await seedWorkspace(page, seed())
  await expect.poll(() => titlesIn(page, 'priority-hot')).toEqual(['Launch'])
  await dragRow(page, row(page, 'Ideas', 'priority-important'), await above(row(page, 'Launch', 'priority-hot')), async () => {
    await expect(page.getByTestId('list-drop-refusal')).toContainText('Can’t move to Hot')
  })
  await expect.poll(() => titlesIn(page, 'priority-hot')).toEqual(['Launch'])
  expect(await stored(page, 'Ideas')).toMatchObject({ important: true })
  expect((await stored(page, 'Ideas'))?.urgent).toBeUndefined()
})

