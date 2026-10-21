import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectCounterLive, installRenderCounter, readRenderCounts, resetRenderCounts } from './fixtures/render-count'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * What a row click, a row hover and a task write render, held without timing (render
 * counts from a stand-in React DevTools hook, `fixtures/render-count`):
 * selecting a row renders that row — and the row it took the selection
 * from — but no other row, in its list or any other, not the shell (top
 * bar, workspace page) and not the editor host. A hover renders the rows it
 * leaves and enters (their hover highlight), nothing else — the editor host
 * not at all while the editor is closed. A task write renders neither the
 * shell nor the editor host. A list grouped by people is the
 * case that used to render every row on any render of its list (each row's
 * people were a fresh array).
 */

const PEOPLE = ['Alice Chen', 'Ben Ortiz', 'Carla Diaz']
const ROWS = 30

/** Task i has the first `i % 4` people: tasks 1, 5, 9 … one person (one row in the people-grouped list). */
const TASKS: NonNullable<WorkspaceSeed['tasks']> = Array.from({ length: ROWS }, (_, i) => ({
  title: `Task ${i}`,
  people: PEOPLE.slice(0, i % 4),
  tags: i % 3 === 0 ? ['planning'] : [],
  dueInDays: i % 3 === 0 ? undefined : (i % 10) - 3,
  urgent: i % 2 === 0,
}))

const WATCHED = [
  'TaskRow', 'ListWidgetBody', 'TaskEditPopupHost', 'AppShell', 'TopBar', 'WorkspacePage', 'WorkspaceCell',
]

/** A plain list and a list grouped by people, side by side. */
const SEED: WorkspaceSeed = {
  people: PEOPLE,
  tags: ['planning'],
  listDefinitions: [{ name: 'Everything' }, { name: 'By person', grouping: 'people' }],
  tasks: TASKS,
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'a', cells: [{ id: 'ca', tabs: [{ id: 'plain', kind: 'lens', listDefIdx: 0 }] }] },
      { id: 'b', cells: [{ id: 'cb', tabs: [{ id: 'grouped', kind: 'lens', listDefIdx: 1 }] }] },
    ],
  }],
}

const titleSel = (name: string) => `[data-task-title="${name}"]`
const title = (scope: Locator, name: string) => scope.locator(titleSel(name))
/** `scope`'s row (or its rows) showing the task `name`, by an attribute it carries. */
const rowWith = (page: Page, scope: Locator, attr: string, name: string) =>
  scope.locator(`[${attr}]`).filter({ has: page.locator(titleSel(name)) })

/** Both lists show their rows with their people (the assignments load after the tasks). */
async function settled(page: Page): Promise<void> {
  await expect(wsListWidget(page, 'plain').locator('[data-todo-id]')).toHaveCount(ROWS)
  await expect(wsListWidget(page, 'grouped').locator('[data-person-avatar]').first()).toBeVisible()
  await expectCounterLive(page, 'TaskRow')
}

/** The pointer rests on `el` first, so the click that follows changes no hover. */
async function clickResting(page: Page, scope: Locator, name: string): Promise<void> {
  await title(scope, name).hover()
  await expect(rowWith(page, scope, 'data-hovered-synced', name)).toHaveCount(1)
  await resetRenderCounts(page)
  await title(scope, name).click()
  await expect(rowWith(page, scope, 'data-selected="true"', name)).toHaveCount(1)
}

test('a row click renders that row only — no other row, list, the shell or the editor host', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await seedWorkspace(page, SEED)
  await settled(page)
  const grouped = wsListWidget(page, 'grouped')
  const plain = wsListWidget(page, 'plain')

  // In the people-grouped list: Task 1 (one person, one row).
  await clickResting(page, grouped, 'Task 1')
  let counts = await readRenderCounts(page)
  expect(counts.TaskRow, 'rows rendered by selecting one').toBe(1)
  expect(counts.ListWidgetBody, 'only the list that holds the selection renders').toBe(1)
  for (const shell of ['AppShell', 'TopBar', 'WorkspacePage', 'WorkspaceCell', 'TaskEditPopupHost']) {
    expect(counts[shell], `${shell} rendered by a row click`).toBe(0)
  }

  // Another row: the one selected and the one that lost the selection.
  await clickResting(page, grouped, 'Task 5')
  counts = await readRenderCounts(page)
  expect(counts.TaskRow).toBe(2)
  expect(counts.TaskEditPopupHost).toBe(0)

  // Into the plain list: its row, and the grouped list's row that lost the selection.
  await clickResting(page, plain, 'Task 9')
  await expect(grouped.locator('[data-selected="true"]')).toHaveCount(0)
  counts = await readRenderCounts(page)
  expect(counts.TaskRow).toBe(2)
  expect(counts.ListWidgetBody).toBe(2)
  expect(counts.AppShell).toBe(0)
  expect(counts.TopBar).toBe(0)
})

test('a row hover renders the rows it leaves and enters, not the editor host while it is closed', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await seedWorkspace(page, {
    ...SEED,
    layouts: [{ name: 'Main', columns: [{ id: 'a', cells: [{ id: 'ca', tabs: [{ id: 'plain', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  const plain = wsListWidget(page, 'plain')
  await expect(plain.locator('[data-todo-id]')).toHaveCount(ROWS)
  await expect(plain.locator('[data-person-avatar]').first()).toBeVisible()
  await expectCounterLive(page, 'TaskRow')
  await expectCounterLive(page, 'TaskEditPopupHost')

  await title(plain, 'Task 3').hover()
  await expect(rowWith(page, plain, 'data-hovered-synced', 'Task 3')).toHaveCount(1)
  await resetRenderCounts(page)
  await title(plain, 'Task 8').hover()
  await expect(rowWith(page, plain, 'data-hovered-synced', 'Task 8')).toHaveCount(1)
  await expect(plain.locator('[data-hovered-synced]')).toHaveCount(1)
  const counts = await readRenderCounts(page)
  expect(counts.TaskRow, 'rows rendered by a hover').toBeLessThanOrEqual(2)
  expect(counts.TaskEditPopupHost, 'the closed editor host rendered by a hover').toBe(0)
  expect(counts.ListWidgetBody).toBe(0)
  expect(counts.TopBar).toBe(0)
})

test('a task write renders that task’s rows, not the shell or the editor host', async ({ page }) => {
  await installRenderCounter(page, WATCHED)
  await seedWorkspace(page, SEED)
  await settled(page)
  const plain = wsListWidget(page, 'plain')
  const checkbox = rowWith(page, plain, 'data-todo-id', 'Task 2').getByRole('checkbox')
  await checkbox.hover()
  await expect(rowWith(page, plain, 'data-hovered-synced', 'Task 2')).toHaveCount(1)
  await resetRenderCounts(page)
  await checkbox.click()
  await expect(rowWith(page, plain, 'data-todo-id', 'Task 2')).toHaveCount(0)
  const counts = await readRenderCounts(page)
  for (const shell of ['AppShell', 'TopBar', 'WorkspacePage', 'TaskEditPopupHost']) {
    expect(counts[shell], `${shell} rendered by a task write`).toBe(0)
  }
})
