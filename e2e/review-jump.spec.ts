import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { expectLayoutStored, expectOpenLayout, layoutTab, reviewField, seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Review buttons' jump (widget feedback 2B, J4) in a real browser: a
 * Review button sets the Review widget's temporary filter and moves the
 * focus into it — the open layout's widget, else the first layout that has
 * one, switched to as the layout tabs switch; no layout written, no undo
 * step. With no Review widget anywhere the buttons are hidden, and they come
 * back as soon as one is added. An open editor with changes asks first, and
 * Keep editing cancels the jump.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Ana report', people: ['Ana Lima'], status: 'Waiting' },
  { title: 'Ana call', people: ['Ana Lima'] },
  { title: 'Bo plan', people: ['Bo Chen'], status: 'Waiting' },
]

const LIST_ROW = wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })

/** The list and a Review widget side by side. */
const SAME: WorkspaceSeed = {
  people: ['Ana Lima', 'Bo Chen'],
  statuses: ['Waiting'],
  tasks: TASKS,
  listDefinitions: [{ name: 'Ana', people: ['Ana Lima'] }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', rows: [LIST_ROW] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'rv', kind: 'review' }] })] },
    ],
  }],
}

/** The list on Main; the Review widget on Review. */
const OTHER: WorkspaceSeed = {
  ...SAME,
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [LIST_ROW] }] },
    { name: 'Review', columns: [{ id: 'r1', rows: [wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] })] }] },
  ],
}

/** No Review widget anywhere. */
const NONE: WorkspaceSeed = { ...SAME, layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [LIST_ROW] }] }] }

const widget = (page: Page) => page.locator('[data-review-widget="rv"]')
const undoCount = (page: Page) => page.evaluate(async () => {
  const mod = (await import(/* @vite-ignore */ '/src/stores/undo-store.ts' as string)) as { useUndoStore: { getState: () => { undoStack: unknown[] } } }
  return mod.useUndoStore.getState().undoStack.length
})

test('on the same layout: the list’s Review these N tasks sets the widget’s filter to the list’s; the focus moves in; nothing saved', async ({ page }) => {
  await seedWorkspace(page, SAME)
  await expect(wsListWidget(page, 't1').locator('[data-todo-id]')).toHaveCount(2)
  const steps = await undoCount(page)
  await wsTab(page, 't1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review these 2 tasks' }).click()
  await expect(reviewField(page, 'rv')).toHaveValue('@"Ana Lima"')
  // Beside the list the widget shows its medium face: the card, no queue column.
  await expect(widget(page).getByTestId('review-card-title')).toHaveText(/^Ana (report|call)$/)
  await expect(widget(page).getByLabel('Status update · today')).toBeFocused()
  // A jump saves nothing: no undo step, the layout as stored.
  expect(await undoCount(page)).toBe(steps)
  await expectLayoutStored(page)
  // A second jump replaces what it was reviewing, without asking.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with bo')
  await page.keyboard.press('Enter')
  await expect(reviewField(page, 'rv')).toHaveValue('@"Bo Chen"')
  await expect(widget(page).getByTestId('review-card-title')).toHaveText('Bo plan')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('on another layout: the person menu’s Review switches to it and shows @Name; the temporary filter is gone after a reload', async ({ page }) => {
  await seedWorkspace(page, OTHER)
  await taskRowByTitle(page, 'Ana report').locator('[data-person-avatar="Ana Lima"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review with Ana Lima' }).click()
  await expectOpenLayout(page, 'Review')
  await expect(reviewField(page, 'rv')).toHaveValue('@"Ana Lima"')
  await expect(widget(page).locator('[data-review-row]')).toHaveCount(2)
  await expect(widget(page).getByLabel('Status update · today')).toBeFocused()
  await page.reload()
  await expect(reviewField(page, 'rv')).toHaveValue('')
})

test('no Review widget anywhere: no Review buttons; adding one brings them back at once', async ({ page }) => {
  await seedWorkspace(page, NONE)
  await wsTab(page, 't1').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: /^Review/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await taskRowByTitle(page, 'Ana report').locator('[data-person-avatar="Ana Lima"]').click({ button: 'right' })
  await expect(page.getByRole('menu', { name: '@Ana Lima' }).getByRole('menuitem')).toHaveText(['Show tasks', 'Edit…', 'Delete…'])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review')
  await expect(page.getByRole('listbox').getByRole('option').filter({ hasText: /Review (With|List)/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A Review widget added (a new layout's first widget): the buttons are there again.
  await page.evaluate(async () => {
    const ws = (await import(/* @vite-ignore */ '/src/stores/workspace-store.ts' as string)) as {
      useWorkspaceStore: { getState: () => { createLayout: (n: string) => Promise<number | null>; addWidget: (k: string, t: { kind: 'layout' }) => string | null } }
    }
    await ws.useWorkspaceStore.getState().createLayout('Reviews')
    ws.useWorkspaceStore.getState().addWidget('review', { kind: 'layout' })
  })
  await expect(page.locator('[data-review-widget]')).toHaveCount(1)
  await layoutTab(page, 'Main').click()
  await expectOpenLayout(page, 'Main')
  await wsTab(page, 't1').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Review these 2 tasks' })).toBeVisible()
})

test('an open editor with changes asks before the jump switches layouts; Keep editing cancels it, Discard goes on', async ({ page }) => {
  await seedWorkspace(page, OTHER)
  await wsTab(page, 't1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  const editor = page.getByTestId('edit-list')
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Name' }).fill('Waiting on others')

  // The palette opens over the editor without closing it; Review With › Ana jumps.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with ana')
  await page.keyboard.press('Enter')
  const ask = page.getByRole('dialog', { name: /^Save changes to list/ })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(ask).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expectOpenLayout(page, 'Main')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with ana')
  await page.keyboard.press('Enter')
  await ask.getByRole('button', { name: 'Discard', exact: true }).click()
  await expectOpenLayout(page, 'Review')
  await expect(reviewField(page, 'rv')).toHaveValue('@"Ana Lima"')
})
