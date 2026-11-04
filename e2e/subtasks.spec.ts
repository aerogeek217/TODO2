import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { drag, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Subtasks in a real browser (cr28): the row's `2/5` count opens the
 * checklist popover (placement, focus handoffs and the Esc that must stop
 * there are the browser's), a check inside it updates the count and stamps
 * the task; the editor's section reorders by a trusted-mouse drag and
 * deletes with the undo snackbar.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Everything' }],
  tasks: [
    {
      title: 'Q4 budget',
      modifiedInDays: -20,
      subtasks: [
        { title: 'Send the template to all leads', done: true },
        { title: 'Headcount from Aisha' },
        { title: 'Get travel actuals from Marco' },
      ],
    },
    { title: 'Bare task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 't', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const countOf = (row: Locator) => row.locator('[data-subtask-count]')
const popover = (page: Page) => page.getByRole('dialog', { name: 'Subtasks of Q4 budget' })
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })
const section = (page: Page) => editor(page).getByRole('region', { name: /Subtasks/ })

/** The stored checklist of `title`: `[title, done]` in order. */
async function storedChecklist(page: Page, title: string): Promise<Array<[string, boolean]>> {
  const task = (await readStore<{ id: number; title: string }>(page, 'todos')).find((t) => t.title === title)
  return (await readStore<{ todoId: number; title: string; isCompleted: boolean; sortOrder: number }>(page, 'subtasks'))
    .filter((s) => s.todoId === task?.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => [s.title, s.isCompleted])
}

async function modifiedAt(page: Page, title: string): Promise<number> {
  const task = (await readStore<{ title: string; modifiedAt: Date }>(page, 'todos')).find((t) => t.title === title)
  return new Date(task?.modifiedAt ?? 0).getTime()
}

test('the row’s count opens the popover; Space checks the focused subtask, the count and Modified follow; ⏎ adds; Esc closes with the focus back on the count', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const row = taskRowByTitle(page, 'Q4 budget')
  await expect(countOf(row)).toHaveText('1/3')
  await expect(countOf(taskRowByTitle(page, 'Bare task'))).toHaveCount(0)
  const before = await modifiedAt(page, 'Q4 budget')

  await countOf(row).click()
  await expect(popover(page)).toBeVisible()
  const headcount = popover(page).getByRole('checkbox', { name: 'Check Headcount from Aisha' })
  await expect(headcount).toBeFocused()
  await page.keyboard.press('Space')
  await expect(countOf(row)).toHaveText('2/3')
  await expect(popover(page).getByText('2 of 3')).toBeVisible()
  await expect.poll(() => storedChecklist(page, 'Q4 budget')).toEqual([
    ['Send the template to all leads', true], ['Headcount from Aisha', true], ['Get travel actuals from Marco', false],
  ])
  expect(await modifiedAt(page, 'Q4 budget')).toBeGreaterThan(before)

  const add = popover(page).getByRole('textbox', { name: 'New subtask' })
  await add.click()
  await add.fill('Review with Ben')
  await add.press('Enter')
  await expect(add).toHaveValue('')
  await expect(add).toBeFocused()
  await expect(countOf(row)).toHaveText('2/4')
  await expect.poll(async () => (await storedChecklist(page, 'Q4 budget')).at(-1)).toEqual(['Review with Ben', false])

  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect(countOf(row)).toBeFocused()
  // The row's own double-click (the editor) is not the count's.
  await expect(editor(page)).toHaveCount(0)
})

test('checking the last open subtask offers Complete task in the snackbar; the task completes only when it is taken', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, tasks: [{ title: 'Q4 budget', subtasks: [{ title: 'only one' }] }] })
  const row = taskRowByTitle(page, 'Q4 budget')
  await countOf(row).click()
  await popover(page).getByRole('checkbox', { name: 'Check only one' }).click()
  await expect(countOf(row)).toHaveText('1/1')
  await expect(countOf(row)).toHaveAttribute('data-all-done', '')
  const offer = page.getByRole('button', { name: 'Complete task' })
  await expect(offer).toBeVisible()
  expect((await readStore<{ isCompleted: boolean }>(page, 'todos'))[0]?.isCompleted).toBe(false)
  await offer.click()
  await expect.poll(async () => (await readStore<{ isCompleted: boolean }>(page, 'todos'))[0]?.isCompleted).toBe(true)
})

test('the editor’s section: a drag reorders the checklist, ⋯ › Delete removes with the undo snackbar, Undo puts it back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  await expect(editor(page)).toBeVisible()
  await expect(section(page).getByText('1 of 3')).toBeVisible()
  const items = section(page).getByRole('listitem')
  await expect(items).toHaveText(['Send the template to all leads', 'Headcount from Aisha', 'Get travel actuals from Marco'])

  // Drag the last row's grip above the first.
  const last = items.nth(2)
  await last.hover()
  const grip = last.getByLabel('Move Get travel actuals from Marco')
  const from = await grip.boundingBox()
  const first = await items.nth(0).boundingBox()
  if (!from || !first) throw new Error('rows not laid out')
  await drag(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: from.x + from.width / 2, y: first.y + 2 })
  await expect(items).toHaveText(['Get travel actuals from Marco', 'Send the template to all leads', 'Headcount from Aisha'])
  await expect.poll(() => storedChecklist(page, 'Q4 budget')).toEqual([
    ['Get travel actuals from Marco', false], ['Send the template to all leads', true], ['Headcount from Aisha', false],
  ])

  await items.nth(1).hover()
  await items.nth(1).getByRole('button', { name: 'Subtask menu: Send the template to all leads' }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await expect(items).toHaveText(['Get travel actuals from Marco', 'Headcount from Aisha'])
  await expect(section(page).getByText('0 of 2')).toBeVisible()
  await expect(page.getByText('Subtask removed')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(items).toHaveText(['Get travel actuals from Marco', 'Send the template to all leads', 'Headcount from Aisha'])
  await expect(editor(page)).toBeVisible()
})

test('a renamed subtask: ⏎ saves, Esc on the field cancels without closing the editor', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await taskRowByTitle(page, 'Q4 budget').locator('span[data-task-title="Q4 budget"]').dblclick()
  await section(page).getByRole('button', { name: 'Rename Headcount from Aisha' }).click()
  const field = section(page).getByRole('textbox', { name: 'Subtask title' })
  await expect(field).toBeFocused()
  await field.fill('Headcount from Aisha and Ben')
  await field.press('Enter')
  await expect(section(page).getByRole('button', { name: 'Rename Headcount from Aisha and Ben' })).toBeVisible()
  await section(page).getByRole('button', { name: 'Rename Headcount from Aisha and Ben' }).click()
  await section(page).getByRole('textbox', { name: 'Subtask title' }).fill('dropped')
  await page.keyboard.press('Escape')
  await expect(editor(page)).toBeVisible()
  await expect(section(page).getByRole('button', { name: 'Rename Headcount from Aisha and Ben' })).toBeVisible()
  expect((await storedChecklist(page, 'Q4 budget')).map(([t]) => t)).toContain('Headcount from Aisha and Ben')
})
